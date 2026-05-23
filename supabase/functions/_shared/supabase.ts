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

export async function requireCharityAdmin(client: SupabaseClient, charityId: string) {
  const user = await requireUser(client);
  // RLS will scope this; non-admin returns no row.
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
  if (m?.role !== 'admin') throw new Response('Forbidden', { status: 403 });
  return user;
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
