import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { edgeFunctions } from '@/lib/edgeFunctions';
import { useAuth } from '@/auth/AuthProvider';

// Members, pending invites with codes, and the team join code for one charity.
// Rendered inside admin/charities/:id for charity admins and super admins.

interface MemberRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: 'admin' | 'rep';
  invited_at: string | null;
  accepted_at: string | null;
  deactivated_at: string | null;
  must_change_password: boolean;
  suspended_at: string | null;
}

function Copy({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="text-xs font-medium text-accent hover:underline"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* clipboard blocked */ }
      }}
    >
      {ok ? 'Copied' : label}
    </button>
  );
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : '';
}

export function MembersSection({ charityId, canAdmin, isSuper }: { charityId: string; canAdmin: boolean; isSuper: boolean }) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const [result, setResult] = useState<{ userId: string; kind: 'link' | 'password'; value: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ['members', charityId],
    queryFn: async (): Promise<MemberRow[]> => {
      const { data, error } = await supabase.rpc('list_charity_members', { c_id: charityId });
      if (error) throw error;
      return ((data ?? []) as MemberRow[]).filter((m) => m.accepted_at !== null || m.deactivated_at !== null);
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['members', charityId] });

  const changeRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: 'admin' | 'rep' }) => {
      const { error } = await supabase.from('charity_members').update({ role }).eq('charity_id', charityId).eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const setActive = useMutation({
    mutationFn: async ({ userId, active }: { userId: string; active: boolean }) => {
      const { error } = await supabase.from('charity_members').update({ deactivated_at: active ? null : new Date().toISOString() }).eq('charity_id', charityId).eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from('charity_members').delete().eq('charity_id', charityId).eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  async function reset(userId: string, method: 'magic_link' | 'temp_password' | 'suspend' | 'unsuspend') {
    setBusy(userId + method); setMessage(null); setResult(null);
    try {
      const r = await edgeFunctions.adminReset({ user_id: userId, charity_id: charityId, method });
      if ('error' in r) throw new Error(r.error);
      if (method === 'magic_link' && r.link) setResult({ userId, kind: 'link', value: r.link });
      else if (method === 'temp_password' && r.password) setResult({ userId, kind: 'password', value: r.password });
      else setMessage(method === 'suspend' ? 'Account suspended.' : 'Account reinstated.');
      refresh();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const list = members.data ?? [];

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Members</h2>
      {members.error && <p className="text-sm text-red-600">{(members.error as Error).message}</p>}
      {members.isLoading ? (
        <div className="text-ink-400 dark:text-ink-500 text-sm">Loading...</div>
      ) : list.length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">No members yet.</p>
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {list.map((m) => {
            const inactive = !!m.deactivated_at;
            const isMe = m.user_id === me?.id;
            const expanded = open === m.user_id;
            return (
              <li key={m.user_id} className={`py-3 space-y-2 ${inactive ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <button type="button" className="min-w-0 text-left flex-1" onClick={() => canAdmin && setOpen(expanded ? null : m.user_id)}>
                    <div className="font-medium truncate">{m.full_name ?? m.email ?? m.user_id}{isMe ? ' (you)' : ''}</div>
                    <div className="text-xs text-ink-500 dark:text-ink-400">
                      <span className="capitalize">{m.role}</span>
                      {m.email && m.full_name ? ` · ${m.email}` : ''}
                      {inactive ? ` · deactivated ${fmtDate(m.deactivated_at)}` : m.accepted_at ? ` · joined ${fmtDate(m.accepted_at)}` : ''}
                      {m.suspended_at ? ' · suspended' : ''}
                      {m.must_change_password ? ' · must set a password' : ''}
                    </div>
                  </button>
                  {canAdmin && (
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        className="bg-ink-100 dark:bg-ink-800 text-sm rounded-lg px-2 py-1"
                        value={m.role}
                        disabled={inactive}
                        onChange={(e) => changeRole.mutate({ userId: m.user_id, role: e.target.value as 'admin' | 'rep' })}
                      >
                        <option value="rep">Rep</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button type="button" className="text-sm text-ink-500 dark:text-ink-400" onClick={() => setOpen(expanded ? null : m.user_id)} aria-expanded={expanded}>
                        {expanded ? 'Close' : 'More'}
                      </button>
                    </div>
                  )}
                </div>

                {canAdmin && expanded && (
                  <div className="rounded-xl bg-ink-50 dark:bg-ink-800/60 p-3 space-y-3 text-sm">
                    {!isMe && !inactive && (
                      <div className="space-y-2">
                        <div className="font-medium">Help them sign in</div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className="btn-primary !py-2 !px-3 !text-sm" disabled={busy !== null} onClick={() => reset(m.user_id, 'magic_link')}>
                            {busy === m.user_id + 'magic_link' ? 'Making link...' : 'Send sign-in link'}
                          </button>
                          <button type="button" className="btn-ghost !py-2 !px-3 !text-sm" disabled={busy !== null} onClick={() => reset(m.user_id, 'temp_password')}>
                            {busy === m.user_id + 'temp_password' ? 'Setting...' : 'Set a temporary password'}
                          </button>
                        </div>
                        {result?.userId === m.user_id && (
                          <div className="rounded-lg bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 p-3 space-y-1">
                            {result.kind === 'link' ? (
                              <>
                                <div className="text-xs text-ink-500 dark:text-ink-400">Text or read this to them. Works once, for 60 minutes. They'll choose a new password after signing in.</div>
                                <div className="font-mono text-xs break-all">{result.value}</div>
                              </>
                            ) : (
                              <>
                                <div className="text-xs text-ink-500 dark:text-ink-400">Give them this password. It works for one sign-in, then they must choose their own.</div>
                                <div className="font-mono text-lg tracking-wide">{result.value}</div>
                              </>
                            )}
                            <Copy text={result.value} />
                          </div>
                        )}
                        <div className="text-xs text-ink-500 dark:text-ink-400">Both actions are recorded in the audit log.</div>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      {!isMe && (
                        inactive ? (
                          <button type="button" className="text-emerald-700 dark:text-emerald-400 font-medium" onClick={() => setActive.mutate({ userId: m.user_id, active: true })}>Reactivate</button>
                        ) : (
                          <button type="button" className="text-red-600 font-medium" onClick={() => { if (confirm('Deactivate this member? They lose access but their notes and donations stay.')) setActive.mutate({ userId: m.user_id, active: false }); }}>Deactivate</button>
                        )
                      )}
                      {isSuper && !isMe && (
                        m.suspended_at ? (
                          <button type="button" className="text-ink-600 dark:text-ink-300" disabled={busy !== null} onClick={() => reset(m.user_id, 'unsuspend')}>Reinstate account</button>
                        ) : (
                          <button type="button" className="text-ink-600 dark:text-ink-300" disabled={busy !== null} onClick={() => { if (confirm('Suspend this account everywhere? They cannot sign in to any charity until reinstated.')) reset(m.user_id, 'suspend'); }}>Suspend account</button>
                        )
                      )}
                      {isSuper && !isMe && (
                        <button type="button" className="text-ink-500 dark:text-ink-400" onClick={() => { if (confirm('Remove this membership entirely? Prefer Deactivate unless this was a mistake.')) remove.mutate(m.user_id); }}>Remove</button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {message && <p className="text-sm text-ink-500 dark:text-ink-400">{message}</p>}
      {canAdmin && <InviteForm charityId={charityId} />}
    </section>
  );
}

function InviteForm({ charityId }: { charityId: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'rep'>('rep');
  const [message, setMessage] = useState<React.ReactNode>(null);

  const invite = useMutation({
    mutationFn: async () => {
      const trimmed = email.trim().toLowerCase();
      if (trimmed) {
        const r = await edgeFunctions.inviteUser({ email: trimmed, charity_id: charityId, role });
        if ('error' in r) throw new Error(r.error);
        return { email: trimmed, code: r.code };
      }
      const { data, error } = await supabase.rpc('create_invite_code', { c_id: charityId, p_role: role, p_email: null });
      if (error) throw error;
      return { email: null, code: (data as { code: string | null } | null)?.code ?? null };
    },
    onSuccess: (r) => {
      setMessage(
        r.email ? (
          <>Invited {r.email}.{r.code ? <> If the email doesn't arrive, give them code <span className="font-mono font-semibold">{r.code}</span> to use at charitytooling.com/#/join.</> : null}</>
        ) : (
          <>Code <span className="font-mono font-semibold">{r.code}</span> created. Anyone with it can join once at charitytooling.com/#/join. It expires in 7 days.</>
        ),
      );
      setEmail('');
      qc.invalidateQueries({ queryKey: ['invitations', charityId] });
      qc.invalidateQueries({ queryKey: ['members', charityId] });
    },
    onError: (err) => setMessage((err as Error).message),
  });

  return (
    <div className="border-t border-ink-100 dark:border-ink-800 pt-4 mt-2">
      <div className="text-sm font-semibold mb-1">Invite a new member</div>
      <p className="text-xs text-ink-500 dark:text-ink-400 mb-2">With an email we send the invite. Leave it blank to get a one-time code you can read out instead.</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input type="email" className="field flex-1" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@example.org (optional)" />
        <select className="field sm:w-32" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'rep')}>
          <option value="rep">Rep</option>
          <option value="admin">Admin</option>
        </select>
        <button type="button" className="btn-primary sm:w-40" disabled={invite.isPending} onClick={() => invite.mutate()}>
          {invite.isPending ? 'Working...' : email.trim() ? 'Send invite' : 'Create code'}
        </button>
      </div>
      {message && <p className="text-sm text-ink-500 dark:text-ink-400 mt-2">{message}</p>}
    </div>
  );
}

export function InvitationsSection({ charityId }: { charityId: string }) {
  const qc = useQueryClient();
  const invitations = useQuery({
    queryKey: ['invitations', charityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitations')
        .select('id, email, role, code, created_at, expires_at, accepted_at')
        .eq('charity_id', charityId)
        .is('accepted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const revoke = useMutation({
    mutationFn: async (invId: string) => {
      const { error } = await supabase.from('invitations').delete().eq('id', invId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations', charityId] }),
  });

  const pending = invitations.data ?? [];
  if (pending.length === 0) return null;

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Pending invitations</h2>
      <ul className="divide-y divide-ink-100 dark:divide-ink-800">
        {pending.map((inv) => {
          const expired = new Date(inv.expires_at) < new Date();
          return (
            <li key={inv.id} className="py-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{inv.email ?? 'Code only'}</div>
                <div className="text-xs text-ink-500 dark:text-ink-400 capitalize">
                  {inv.role} · {expired ? 'expired' : `expires ${new Date(inv.expires_at).toLocaleDateString()}`}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {inv.code && (
                  <span className="font-mono text-sm">{inv.code} <Copy text={inv.code} /></span>
                )}
                <button type="button" className="text-red-600 text-sm" onClick={() => { if (confirm('Revoke this invitation?')) revoke.mutate(inv.id); }}>Revoke</button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function JoinCodeCard({ charityId }: { charityId: string }) {
  const qc = useQueryClient();
  const [role, setRole] = useState<'admin' | 'rep'>('rep');
  const [message, setMessage] = useState<string | null>(null);
  const current = useQuery({
    queryKey: ['join-code', charityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('join_codes')
        .select('id, code, role, max_uses, uses, expires_at, revoked_at')
        .eq('charity_id', charityId)
        .is('revoked_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const rotate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('rotate_join_code', { c_id: charityId, p_role: role, p_max_uses: 25, p_days: 30 });
      if (error) throw error;
    },
    onSuccess: () => { setMessage(null); qc.invalidateQueries({ queryKey: ['join-code', charityId] }); },
    onError: (err) => setMessage((err as Error).message),
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('join_codes').update({ revoked_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['join-code', charityId] }),
  });

  const jc = current.data;
  const live = jc && new Date(jc.expires_at) > new Date() && jc.uses < jc.max_uses;

  return (
    <section className="card space-y-3">
      <div>
        <h2 className="font-semibold">Team join code</h2>
        <p className="text-xs text-ink-500 dark:text-ink-400">One code a whole group can use at charitytooling.com/#/join. Up to 25 people, 30 days. Regenerating stops the old code at once; people already joined keep their accounts.</p>
      </div>
      {jc && (
        <div className="rounded-xl bg-ink-50 dark:bg-ink-800/60 p-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-xl tracking-widest">{jc.code}</div>
            <div className="text-xs text-ink-500 dark:text-ink-400 capitalize">
              joins as {jc.role} · {Math.max(0, jc.max_uses - jc.uses)} of {jc.max_uses} uses left · {live ? `expires ${new Date(jc.expires_at).toLocaleDateString()}` : 'no longer valid'}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Copy text={jc.code} />
            <button type="button" className="text-red-600 text-sm" onClick={() => { if (confirm('Stop this join code now?')) revoke.mutate(jc.id); }}>Stop</button>
          </div>
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-2">
        <select className="field sm:w-40" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'rep')}>
          <option value="rep">Joins as rep</option>
          <option value="admin">Joins as admin</option>
        </select>
        <button type="button" className="btn-ghost sm:w-48" disabled={rotate.isPending} onClick={() => { if (!jc || confirm('Make a new code? The current one stops working.')) rotate.mutate(); }}>
          {rotate.isPending ? 'Working...' : jc ? 'Regenerate' : 'Create join code'}
        </button>
      </div>
      {message && <p className="text-sm text-red-600">{message}</p>}
    </section>
  );
}
