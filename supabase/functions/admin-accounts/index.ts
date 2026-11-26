// admin-accounts
//
// The list behind the admin page on costtooling.com/admin/ and casetooling.com/admin/:
// every account on this project with the ways it signs in and the sites it is on.
//
// Body: { action: 'list' }
//
// Auth: the caller's own sign-in, and only a super admin (profiles.is_super_admin) is
// answered. Anyone else gets a 403 and no list. The gateway's JWT check is off for this
// function (config.toml): the function asks the Auth server who is calling, so a browser
// session is checked the same way whatever key signed it.
//
// It only reads. It never returns a case, a job, a photo or a note: for each site it
// says whether the account is on it, in what role, and how many things it holds there.
// CaseTooling's own rules let nobody but a case's people read it, and this function
// keeps to counts for that reason.
//
// The actions that change an account (turn off, reset, delete) are not here yet.

import { requireSuperAdmin, serviceClient, userClient } from '../_shared/supabase.ts';

// The two sites that carry the admin page, and the ports they are run on locally.
const ALLOWED_ORIGINS = [
  'https://costtooling.com',
  'https://www.costtooling.com',
  'https://casetooling.com',
  'https://www.casetooling.com',
  'http://127.0.0.1:8766',
  'http://localhost:8766',
  'http://localhost:8782',
];

function cors(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'content-type': 'application/json' } });
}

type AuthUser = {
  id: string;
  email?: string | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
  banned_until?: string | null;
  app_metadata?: { providers?: string[]; provider?: string } | null;
  user_metadata?: { full_name?: string; name?: string } | null;
};

function isOff(u: AuthUser): boolean {
  return !!u.banned_until && Date.parse(u.banned_until) > Date.now();
}

function count<T>(rows: T[] | null, key: (r: T) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows ?? []) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return m;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, origin);

  try {
    try {
      await requireSuperAdmin(userClient(req));
    } catch (e) {
      const status = e instanceof Response ? e.status : 401;
      return json({ error: status === 403 ? 'This page is for the admin.' : 'Sign in first.' }, status === 403 ? 403 : 401, origin);
    }

    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action !== 'list') return json({ error: 'Unknown action.' }, 400, origin);

    const service = serviceClient();

    const users: AuthUser[] = [];
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) return json({ error: `The accounts could not be read: ${error.message}` }, 500, origin);
      users.push(...(data.users as AuthUser[]));
      if (data.users.length < 1000) break;
    }

    const [profiles, ctMembers, ctCompanies, ctProjects, csAccounts, csMembers, charityMembers] = await Promise.all([
      service.from('profiles').select('id, full_name, is_super_admin'),
      service.from('ct_company_members').select('company_id, user_id, role, deactivated_at'),
      service.from('ct_companies').select('id, name'),
      service.from('ct_projects').select('company_id').is('deleted_at', null),
      service.from('cs_accounts').select('user_id, display_name'),
      service.from('cs_members').select('user_id'),
      service.from('charity_members').select('user_id').is('deactivated_at', null),
    ]);
    for (const r of [profiles, ctMembers, ctCompanies, ctProjects, csAccounts, csMembers, charityMembers]) {
      if (r.error) return json({ error: `The accounts could not be read: ${r.error.message}` }, 500, origin);
    }

    const profileById = new Map((profiles.data ?? []).map((p) => [p.id as string, p]));
    const companyName = new Map((ctCompanies.data ?? []).map((c) => [c.id as string, c.name as string]));
    const jobsByCompany = count(ctProjects.data as Array<{ company_id: string }> | null, (r) => r.company_id);
    const caseName = new Map((csAccounts.data ?? []).map((a) => [a.user_id as string, a.display_name as string]));
    const casesByUser = count(csMembers.data as Array<{ user_id: string }> | null, (r) => r.user_id);
    const charitiesByUser = count(charityMembers.data as Array<{ user_id: string }> | null, (r) => r.user_id);
    const companiesByUser = new Map<string, Array<{ company: string; role: string; off: boolean; jobs: number }>>();
    for (const m of (ctMembers.data ?? []) as Array<{ company_id: string; user_id: string; role: string; deactivated_at: string | null }>) {
      const list = companiesByUser.get(m.user_id) ?? [];
      list.push({ company: companyName.get(m.company_id) ?? 'A company', role: m.role, off: m.deactivated_at !== null, jobs: jobsByCompany.get(m.company_id) ?? 0 });
      companiesByUser.set(m.user_id, list);
    }

    const accounts = users
      .map((u) => {
        const providers = u.app_metadata?.providers ?? (u.app_metadata?.provider ? [u.app_metadata.provider] : []);
        const p = profileById.get(u.id);
        return {
          id: u.id,
          email: u.email ?? null,
          name: (p?.full_name as string | null) || u.user_metadata?.full_name || u.user_metadata?.name || caseName.get(u.id) || null,
          signed_up_at: u.created_at ?? null,
          last_sign_in_at: u.last_sign_in_at ?? null,
          confirmed: !!u.email_confirmed_at,
          off: isOff(u),
          admin: p?.is_super_admin === true,
          ways_in: { password: providers.includes('email'), google: providers.includes('google') },
          costtooling: companiesByUser.get(u.id) ?? [],
          casetooling: { on: caseName.has(u.id), cases: casesByUser.get(u.id) ?? 0 },
          charities: charitiesByUser.get(u.id) ?? 0,
        };
      })
      .sort((a, b) => (b.last_sign_in_at ?? '').localeCompare(a.last_sign_in_at ?? ''));

    return json({ accounts, count: accounts.length }, 200, origin);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'The accounts could not be read.' }, 500, origin);
  }
});
