// invite-user
//
// Body: { email: string, charity_id: string, role: 'admin' | 'rep' }
//
// Auth: caller must be super_admin OR an admin of `charity_id`.
// Action: uses the admin API to invite the email; inserts an `invitations`
// row that `handle_new_user` reconciles into `charity_members` on first sign-in.

import { handleOptions, json } from '../_shared/cors.ts';
import { requireCharityAdmin, serviceClient, userClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');

  if (req.method !== 'POST') {
    return json({ error: 'method-not-allowed' }, { status: 405 }, origin);
  }

  try {
    const body = (await req.json()) as { email?: string; charity_id?: string; role?: 'admin' | 'rep' };
    if (!body.email || !body.charity_id || !body.role) {
      return json({ error: 'missing-fields' }, { status: 400 }, origin);
    }
    if (body.role !== 'admin' && body.role !== 'rep') {
      return json({ error: 'invalid-role' }, { status: 400 }, origin);
    }

    const user = userClient(req);
    const caller = await requireCharityAdmin(user, body.charity_id);

    const service = serviceClient();

    // Generate a token; this is mostly bookkeeping since reconciliation
    // happens via email match in handle_new_user(), but we keep it for
    // future deep-link flows.
    const token = crypto.randomUUID();

    const { error: invErr } = await service.from('invitations').insert({
      email: body.email.trim().toLowerCase(),
      charity_id: body.charity_id,
      role: body.role,
      token,
      invited_by: caller.id,
    });
    if (invErr) return json({ error: invErr.message }, { status: 500 }, origin);

    // Trigger the Supabase Auth invite email. shouldCreateUser defaults true
    // here because we explicitly want to create the auth.users row server-side.
    const redirectTo = origin ?? 'https://charitytooling.com';
    const { data: inviteData, error: inviteErr } = await service.auth.admin.inviteUserByEmail(
      body.email,
      { redirectTo },
    );
    if (inviteErr && !/already.*registered/i.test(inviteErr.message)) {
      return json({ error: inviteErr.message }, { status: 500 }, origin);
    }

    // If the user already exists, attach them to the charity directly.
    if (inviteErr) {
      const { data: existing } = await service
        .from('profiles')
        .select('id')
        .eq('email', body.email.trim().toLowerCase())
        .maybeSingle();
      if (existing) {
        await service.from('charity_members').upsert({
          charity_id: body.charity_id,
          user_id: existing.id,
          role: body.role,
          invited_by: caller.id,
          accepted_at: new Date().toISOString(),
        });
      }
    }

    return json({ ok: true, user: inviteData?.user ?? null }, {}, origin);
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }, origin);
  }
});
