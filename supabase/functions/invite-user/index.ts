// invite-user
//
// Body: { app?: 'charity' | 'ct', email: string, charity_id | company_id: string, role: string }
//   charity roles: 'admin' | 'rep'   ct roles: 'admin' | 'member'
//
// Auth: caller must be super_admin OR an active admin of the tenant.
// Action: inserts an invitations row (with a short code the admin can read
// out if the email never arrives) and sends the Supabase Auth invite email.
// handle_new_user reconciles the row into membership when the person signs
// up; if they already have an account they are attached straight away.

import { handleOptions, json } from '../_shared/cors.ts';
import { APPS, appOf, redirectBase, requireTenantAdmin, serviceClient, userClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');

  if (req.method !== 'POST') {
    return json({ error: 'method-not-allowed' }, { status: 405 }, origin);
  }

  try {
    const body = (await req.json()) as { email?: string; charity_id?: string; company_id?: string; role?: string; app?: string };
    const app = appOf(body.app);
    const cfg = APPS[app];
    const tenantId = app === 'ct' ? body.company_id : body.charity_id;
    if (!body.email || !tenantId || !body.role) {
      return json({ error: 'missing-fields' }, { status: 400 }, origin);
    }
    if (!(cfg.roles as readonly string[]).includes(body.role)) {
      return json({ error: 'invalid-role' }, { status: 400 }, origin);
    }

    const user = userClient(req);
    const caller = await requireTenantAdmin(user, app, tenantId);

    const service = serviceClient();

    const token = crypto.randomUUID();
    // Every emailed invite also carries a short code the admin can read out if
    // the email never arrives; the invitee can redeem it on the app's join screen.
    const { data: code } = await service.rpc(cfg.newCode, { c_id: tenantId });

    const { error: invErr } = await service.from(cfg.invitations).insert({
      email: body.email.trim().toLowerCase(),
      [cfg.tenantKey]: tenantId,
      role: body.role,
      token,
      invited_by: caller.id,
      code: typeof code === 'string' ? code : null,
    });
    if (invErr) return json({ error: invErr.message }, { status: 500 }, origin);

    // Trigger the Supabase Auth invite email, landing on the app's welcome
    // screen so the invitee sets a password before continuing.
    const redirectTo = redirectBase(app, origin).toString();
    const { data: inviteData, error: inviteErr } = await service.auth.admin.inviteUserByEmail(
      body.email,
      { redirectTo },
    );
    if (inviteErr && !/already.*registered/i.test(inviteErr.message)) {
      return json({ error: inviteErr.message }, { status: 500 }, origin);
    }

    // If the user already exists, attach them to the tenant directly.
    if (inviteErr) {
      const { data: existing } = await service
        .from('profiles')
        .select('id')
        .eq('email', body.email.trim().toLowerCase())
        .maybeSingle();
      if (existing) {
        await service.from(cfg.members).upsert({
          [cfg.tenantKey]: tenantId,
          user_id: existing.id,
          role: body.role,
          invited_by: caller.id,
          accepted_at: new Date().toISOString(),
          deactivated_at: null,
        }, { onConflict: `${cfg.tenantKey},user_id` });
      }
    }

    return json({ ok: true, code: typeof code === 'string' ? code : null, user: inviteData?.user ?? null }, {}, origin);
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }, origin);
  }
});
