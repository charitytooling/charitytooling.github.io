// join-with-code
//
// Public (verify_jwt = false). Lets someone with an invite code or a team join
// code create their own account, or attach an existing account to a charity.
//
// Body: { action: 'check' | 'join', code: string, email?: string }
//   check -> { ok, charity_name, role, kind, email_bound } or { ok:false, reason }
//   join  -> { ok, existing, charity_name, role } or { ok:false, reason }
//
// Public sign-up stays disabled in Supabase Auth. A new account is created the
// same way admin invites are: an email-bound `invitations` row (so
// handle_new_user grants membership) plus auth.admin.inviteUserByEmail, which
// emails a link to /#/welcome where the person sets a password. Rate limited
// per IP by code_attempt_allowed().

import { handleOptions, json } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabase.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') return json({ error: 'method-not-allowed' }, { status: 405 }, origin);

  try {
    const body = (await req.json()) as { action?: string; code?: string; email?: string };
    const code = String(body.code ?? '').replace(/\s+/g, '').toUpperCase();
    const action = body.action === 'join' ? 'join' : 'check';
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!code) return json({ ok: false, reason: 'missing-code' }, { status: 400 }, origin);

    const service = serviceClient();
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'unknown';
    const { data: allowed } = await service.rpc('code_attempt_allowed', { p_ip: ip, p_limit: 10 });
    if (allowed === false) return json({ ok: false, reason: 'too-many-attempts' }, { status: 429 }, origin);

    const { data: rows, error: lookErr } = await service.rpc('lookup_code', { p_code: code });
    if (lookErr) return json({ error: lookErr.message }, { status: 500 }, origin);
    const info = (rows as Array<{ kind: string; charity_id: string; charity_name: string; role: 'admin' | 'rep'; email: string | null; invited_by: string | null; valid: boolean; reason: string | null }> | null)?.[0];
    if (!info || !info.valid) return json({ ok: false, reason: info?.reason ?? 'not-found' }, {}, origin);

    if (action === 'check') {
      return json({ ok: true, charity_name: info.charity_name, role: info.role, kind: info.kind, email_bound: !!info.email }, {}, origin);
    }

    if (!EMAIL_RE.test(email)) return json({ ok: false, reason: 'invalid-email' }, { status: 400 }, origin);
    if (info.email && info.email.toLowerCase() !== email) return json({ ok: false, reason: 'email-mismatch' }, {}, origin);

    // Already have an account? Attach (or reactivate) the membership directly.
    const { data: existing } = await service.from('profiles').select('id').eq('email', email).maybeSingle();
    if (existing) {
      const { error: upErr } = await service.from('charity_members').upsert(
        { charity_id: info.charity_id, user_id: existing.id, role: info.role, invited_by: info.invited_by, accepted_at: new Date().toISOString(), deactivated_at: null },
        { onConflict: 'charity_id,user_id' },
      );
      if (upErr) return json({ error: upErr.message }, { status: 500 }, origin);
      await service.rpc('consume_code', { p_code: code });
      await service.from('audit_log').insert({ actor_id: existing.id, charity_id: info.charity_id, entity_type: 'account', entity_id: existing.id, action: 'update', diff: { event: 'joined-with-code', kind: info.kind, role: info.role, existing: true } });
      return json({ ok: true, existing: true, charity_name: info.charity_name, role: info.role }, {}, origin);
    }

    // New account: email-bound invitation row so handle_new_user grants membership, then the standard invite email.
    const { error: invErr } = await service.from('invitations').insert({
      email, charity_id: info.charity_id, role: info.role, token: crypto.randomUUID(), invited_by: info.invited_by,
    });
    if (invErr) return json({ error: invErr.message }, { status: 500 }, origin);

    const target = new URL(origin && /charitytooling\.com$|localhost/.test(new URL(origin).hostname) ? origin : 'https://charitytooling.com');
    target.hash = '#/welcome';
    const { data: inviteData, error: inviteErr } = await service.auth.admin.inviteUserByEmail(email, { redirectTo: target.toString() });
    if (inviteErr) return json({ error: inviteErr.message }, { status: 500 }, origin);

    await service.rpc('consume_code', { p_code: code });
    const newId = inviteData?.user?.id ?? null;
    if (newId) await service.from('audit_log').insert({ actor_id: newId, charity_id: info.charity_id, entity_type: 'account', entity_id: newId, action: 'insert', diff: { event: 'joined-with-code', kind: info.kind, role: info.role, existing: false } });
    return json({ ok: true, existing: false, charity_name: info.charity_name, role: info.role }, {}, origin);
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }, origin);
  }
});
