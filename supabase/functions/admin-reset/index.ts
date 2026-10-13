// admin-reset
//
// Body: { app?: 'charity' | 'ct', user_id, charity_id | company_id, method: 'magic_link' | 'temp_password' | 'suspend' | 'unsuspend' }
//
// Auth: magic_link / temp_password need a super admin or an active admin of
// the tenant whose target is a member of that tenant. suspend / unsuspend are
// super admin only (a ban affects every tenant and both apps).
//
// This is the only place the service-role key touches another user's
// credentials. Every call writes an audit_log row.

import { handleOptions, json } from '../_shared/cors.ts';
import { APPS, appOf, redirectBase, requireSuperAdmin, requireTenantAdmin, serviceClient, userClient } from '../_shared/supabase.ts';

const WORDS = ['oak', 'river', 'maple', 'cedar', 'stone', 'brook', 'harbor', 'meadow', 'ridge', 'pine', 'willow', 'summit', 'canyon', 'delta', 'ember', 'falcon', 'garden', 'heron', 'island', 'juniper', 'kestrel', 'lantern', 'marble', 'north', 'orchard', 'prairie', 'quartz', 'raven', 'saddle', 'timber', 'valley', 'walnut', 'yonder', 'zephyr', 'amber', 'birch', 'copper', 'dune', 'elm', 'fern'];
function tempPassword(): string {
  const r = new Uint32Array(3); crypto.getRandomValues(r);
  return `${WORDS[r[0] % WORDS.length]}-${WORDS[r[1] % WORDS.length]}-${10 + (r[2] % 90)}`;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') return json({ error: 'method-not-allowed' }, { status: 405 }, origin);

  try {
    const body = (await req.json()) as { user_id?: string; charity_id?: string; company_id?: string; method?: string; app?: string };
    const app = appOf(body.app);
    const cfg = APPS[app];
    const tenantId = app === 'ct' ? body.company_id : body.charity_id;
    const method = body.method;
    if (!body.user_id || !method || !['magic_link', 'temp_password', 'suspend', 'unsuspend'].includes(method)) {
      return json({ error: 'missing-fields' }, { status: 400 }, origin);
    }
    const user = userClient(req);
    const service = serviceClient();

    let caller;
    if (method === 'suspend' || method === 'unsuspend') {
      caller = await requireSuperAdmin(user);
    } else {
      if (!tenantId) return json({ error: 'missing-fields' }, { status: 400 }, origin);
      caller = await requireTenantAdmin(user, app, tenantId);
      const { data: isSuper } = await service.from('profiles').select('is_super_admin').eq('id', caller.id).maybeSingle();
      if (!isSuper?.is_super_admin) {
        const { data: m } = await service.from(cfg.members).select('user_id').eq(cfg.tenantKey, tenantId).eq('user_id', body.user_id).maybeSingle();
        if (!m) return json({ error: 'not-a-member' }, { status: 403 }, origin);
      }
    }
    if (body.user_id === caller.id && method !== 'magic_link') return json({ error: 'cannot-target-self' }, { status: 400 }, origin);

    const { data: target, error: tErr } = await service.auth.admin.getUserById(body.user_id);
    if (tErr || !target?.user?.email) return json({ error: 'user-not-found' }, { status: 404 }, origin);
    const email = target.user.email;

    const audit = (diff: Record<string, unknown>) => service.from('audit_log').insert({
      actor_id: caller.id, charity_id: app === 'charity' ? (tenantId ?? null) : null, entity_type: 'account', entity_id: body.user_id, action: 'update', diff: { method, app, tenant_id: tenantId ?? null, ...diff },
    });

    if (method === 'magic_link') {
      const base = redirectBase(app, origin);
      const { data, error } = await service.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: base.toString() } });
      if (error) return json({ error: error.message }, { status: 500 }, origin);
      await service.from('profiles').update({ must_change_password: true }).eq('id', body.user_id);
      await audit({});
      return json({ ok: true, link: data.properties?.action_link ?? null, expires_minutes: 60 }, {}, origin);
    }
    if (method === 'temp_password') {
      const password = tempPassword();
      const { error } = await service.auth.admin.updateUserById(body.user_id, { password });
      if (error) return json({ error: error.message }, { status: 500 }, origin);
      await service.from('profiles').update({ must_change_password: true }).eq('id', body.user_id);
      await audit({});
      return json({ ok: true, password }, {}, origin);
    }
    if (method === 'suspend') {
      const { error } = await service.auth.admin.updateUserById(body.user_id, { ban_duration: '876000h' });
      if (error) return json({ error: error.message }, { status: 500 }, origin);
      await service.from('profiles').update({ suspended_at: new Date().toISOString() }).eq('id', body.user_id);
      await audit({});
      return json({ ok: true }, {}, origin);
    }
    const { error } = await service.auth.admin.updateUserById(body.user_id, { ban_duration: 'none' });
    if (error) return json({ error: error.message }, { status: 500 }, origin);
    await service.from('profiles').update({ suspended_at: null }).eq('id', body.user_id);
    await audit({});
    return json({ ok: true }, {}, origin);
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }, origin);
  }
});
