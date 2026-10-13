// Helpers for spinning up Supabase clients inside Edge Functions.
//
// `userClient(req)`        - acts as the calling user, respects RLS
// `serviceClient()`        - acts as service_role; use only for trusted admin paths

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
}

export function userClient(req: Request): SupabaseClient {
  const auth = req.headers.get('Authorization') ?? '';
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
}

export function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// Which app is calling. CharityTooling and CostTooling share this project and
// its auth users; each has its own tenant tables. Account functions take an
// optional `app` in the body and default to charity.
export type AppKey = 'charity' | 'ct';
export const APPS = {
  charity: {
    members: 'charity_members', invitations: 'invitations', tenantKey: 'charity_id', nameKey: 'charity_name',
    roles: ['admin', 'rep'], lookup: 'lookup_code', consume: 'consume_code', newCode: 'new_invite_code',
    tenants: 'charities',
    base: 'https://charitytooling.com', originRe: /charitytooling\.com$|^localhost$/,
    welcome(u: URL) { u.hash = '#/welcome'; },
  },
  ct: {
    members: 'ct_company_members', invitations: 'ct_invitations', tenantKey: 'company_id', nameKey: 'company_name',
    roles: ['admin', 'member'], lookup: 'ct_lookup_code', consume: 'ct_consume_code', newCode: 'ct_new_invite_code',
    tenants: 'ct_companies',
    base: 'https://costtooling.com', originRe: /costtooling\.com$|^localhost$|^127\.0\.0\.1$/,
    welcome(u: URL) { u.searchParams.set('auth', 'welcome'); },
  },
} as const;
export function appOf(v: unknown): AppKey { return v === 'ct' ? 'ct' : 'charity'; }
export function redirectBase(app: AppKey, origin: string | null): URL {
  const cfg = APPS[app];
  let base: string = cfg.base;
  try { if (origin && cfg.originRe.test(new URL(origin).hostname)) base = origin; } catch { /* keep default */ }
  const u = new URL(base);
  cfg.welcome(u);
  return u;
}

export async function requireUser(client: SupabaseClient) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new Response('Unauthorized', { status: 401 });
  }
  return data.user;
}

export async function requireSuperAdmin(client: SupabaseClient) {
  const user = await requireUser(client);
  const { data, error } = await client
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new Response(error.message, { status: 500 });
  if (!data?.is_super_admin) throw new Response('Forbidden', { status: 403 });
  return user;
}

// Tenant-aware admin check: super admin, or an active admin of the tenant in the given app.
export async function requireTenantAdmin(client: SupabaseClient, app: AppKey, tenantId: string) {
  const user = await requireUser(client);
  const { data: profile } = await client.from('profiles').select('is_super_admin').eq('id', user.id).maybeSingle();
  if (profile?.is_super_admin) return user;
  const cfg = APPS[app];
  const { data: m } = await client.from(cfg.members).select('role, deactivated_at').eq(cfg.tenantKey, tenantId).eq('user_id', user.id).maybeSingle();
  if (m?.role !== 'admin' || m?.deactivated_at) throw new Response('Forbidden', { status: 403 });
  return user;
}

export async function requireCharityAdmin(client: SupabaseClient, charityId: string) {
  return requireTenantAdmin(client, 'charity', charityId);
}

export async function requireCharityMember(client: SupabaseClient, charityId: string) {
  const user = await requireUser(client);
  const { data: profile } = await client
    .from('profiles')
    .select('is_super_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.is_super_admin) return user;
  const { data: m } = await client
    .from('charity_members')
    .select('role')
    .eq('charity_id', charityId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!m) throw new Response('Forbidden', { status: 403 });
  return user;
}

/** User metadata attached to an invite so the auth-email hook can name the inviter and the company/charity. */
export async function inviteMetadata(service: ReturnType<typeof serviceClient>, app: AppKey, tenantId: string, inviterId: string | null) {
  const cfg = APPS[app];
  const [{ data: tenant }, { data: inviter }] = await Promise.all([
    service.from(cfg.tenants).select('name').eq('id', tenantId).maybeSingle(),
    inviterId ? service.from('profiles').select('full_name, email').eq('id', inviterId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const inviterName = (inviter?.full_name as string | null)?.trim() || (inviter?.email as string | null)?.split('@')[0] || '';
  return { app, tenant_name: (tenant?.name as string | null) ?? '', invited_by_name: inviterName };
}
