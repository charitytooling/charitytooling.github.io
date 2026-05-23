import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { edgeFunctions } from '@/lib/edgeFunctions';
import { useIsSuperAdmin, useMyMemberships } from '@/state/profile';
import {
  useTemplates,
  useUpsertTemplate,
  useDeleteTemplate,
  type TemplateRow,
  type TemplateKind,
} from '@/state/templates';

export function CharityDetail() {
  const { id } = useParams<{ id: string }>();
  const charityId = id!;
  const isSuper = useIsSuperAdmin();
  const { data: memberships } = useMyMemberships();
  const myRole = memberships?.find((m) => m.charity_id === charityId)?.role;
  const canAdmin = isSuper || myRole === 'admin';

  const charity = useQuery({
    queryKey: ['charity', charityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('charities')
        .select('*')
        .eq('id', charityId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  if (charity.isLoading) {
    return <div className="mx-auto max-w-3xl px-4 py-6 text-ink-400 dark:text-ink-500">Loading...</div>;
  }
  if (charity.error || !charity.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 text-red-600">
        {(charity.error as Error)?.message ?? 'Charity not found.'}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold truncate">{charity.data.name}</h1>
        <Link to="/admin" className="text-ink-500 dark:text-ink-400 text-sm">Back</Link>
      </div>

      {canAdmin ? (
        <SettingsCard charity={charity.data} />
      ) : (
        <div className="card">
          <p className="text-ink-500 dark:text-ink-400 text-sm">View-only. Admins can edit settings, members, and templates.</p>
        </div>
      )}

      <MembersSection charityId={charityId} canAdmin={canAdmin} />
      {canAdmin && <InvitationsSection charityId={charityId} />}
      {canAdmin && <TemplatesSection charityId={charityId} />}
      {canAdmin && <StripeSection charity={charity.data} />}
    </div>
  );
}

function StripeSection({ charity }: { charity: Record<string, unknown> }) {
  const connect = useMutation({
    mutationFn: async () =>
      edgeFunctions.stripeConnect({ action: 'start', charity_id: charity.id as string }),
  });

  const connected = charity.stripe_account_id && charity.stripe_charges_enabled;

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Card donations (Stripe)</h2>
      {connected ? (
        <p className="text-sm text-ink-700 dark:text-ink-200">
          Connected to Stripe account <code className="text-xs">{charity.stripe_account_id as string}</code>.
          Donors who pay via the "Donate now" link in your emails will appear here automatically.
        </p>
      ) : charity.stripe_account_id ? (
        <p className="text-sm text-amber-700">
          Stripe is partially connected (account <code className="text-xs">{charity.stripe_account_id as string}</code>),
          but charges are not enabled yet. Complete onboarding in Stripe.
        </p>
      ) : (
        <p className="text-sm text-ink-700 dark:text-ink-200">
          Connect Stripe to let donors pay by card directly from your emails. The charity owns the Stripe account; CharityTooling never holds funds.
        </p>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={connect.isPending}
        onClick={async () => {
          const res = await connect.mutateAsync();
          if (res.url) window.location.href = res.url;
        }}
      >
        {connect.isPending ? 'Loading...' : connected ? 'Re-connect Stripe' : 'Connect Stripe'}
      </button>
      {connect.error && <p className="text-red-600 text-sm">{(connect.error as Error).message}</p>}
    </section>
  );
}

const TEMPLATE_KINDS: { value: TemplateKind; label: string }[] = [
  { value: 'thank_you', label: 'Thank you' },
  { value: 'donation_receipt', label: 'Donation receipt' },
  { value: 'follow_up', label: 'Follow up' },
  { value: 'intro', label: 'Intro' },
  { value: 'custom', label: 'Custom' },
];

function TemplatesSection({ charityId }: { charityId: string }) {
  const templates = useTemplates(charityId);
  const upsert = useUpsertTemplate();
  const del = useDeleteTemplate();
  const [editing, setEditing] = useState<Partial<TemplateRow> | null>(null);

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Email templates</h2>
        <button
          type="button"
          className="text-accent text-sm"
          onClick={() =>
            setEditing({
              charity_id: charityId,
              kind: 'thank_you',
              name: '',
              subject: '',
              body_md: '',
              is_default: false,
            })
          }
        >
          + New
        </button>
      </div>
      {templates.isLoading ? (
        <div className="text-ink-400 dark:text-ink-500 text-sm">Loading...</div>
      ) : (templates.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">No templates yet.</p>
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {(templates.data ?? []).map((t) => (
            <li key={t.id} className="py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium truncate">{t.name}</div>
                <div className="text-xs text-ink-500 dark:text-ink-400">
                  {t.kind.replace('_', ' ')}{t.is_default && ' - default'}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button className="text-sm text-ink-600 dark:text-ink-300" onClick={() => setEditing(t)}>Edit</button>
                <button
                  className="text-sm text-red-600"
                  onClick={() => {
                    if (confirm('Delete this template?')) del.mutate(t.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <TemplateEditor
          template={editing}
          onCancel={() => setEditing(null)}
          onSave={async (next) => {
            await upsert.mutateAsync({ ...next, charity_id: charityId });
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function TemplateEditor({
  template,
  onCancel,
  onSave,
}: {
  template: Partial<TemplateRow>;
  onCancel: () => void;
  onSave: (t: Partial<TemplateRow> & { name: string; subject: string; body_md: string; kind: TemplateKind; charity_id: string }) => Promise<void>;
}) {
  const [t, setT] = useState<Partial<TemplateRow>>(template);

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-ink-900/40 px-3" onClick={onCancel}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-ink-900 p-4 shadow-xl safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold mb-3">{template.id ? 'Edit template' : 'New template'}</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Name</label>
              <input
                className="field"
                value={t.name ?? ''}
                onChange={(e) => setT((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Kind</label>
              <select
                className="field"
                value={t.kind ?? 'thank_you'}
                onChange={(e) => setT((p) => ({ ...p, kind: e.target.value as TemplateKind }))}
              >
                {TEMPLATE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Subject</label>
            <input
              className="field"
              value={t.subject ?? ''}
              onChange={(e) => setT((p) => ({ ...p, subject: e.target.value }))}
              placeholder="Thank you, {{customer.first_name}}!"
            />
          </div>
          <div>
            <label className="label">Body (Markdown, supports {'{{customer.first_name}}'} etc.)</label>
            <textarea
              className="field font-mono text-xs"
              rows={10}
              value={t.body_md ?? ''}
              onChange={(e) => setT((p) => ({ ...p, body_md: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={t.is_default ?? false}
              onChange={(e) => setT((p) => ({ ...p, is_default: e.target.checked }))}
            />
            Use as the default template for this kind
          </label>
        </div>
        <div className="flex gap-2 mt-4">
          <button type="button" className="btn-ghost flex-1" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={!t.name || !t.subject || !t.body_md || !t.kind}
            onClick={() =>
              onSave({
                id: t.id,
                name: t.name!,
                subject: t.subject!,
                body_md: t.body_md!,
                kind: t.kind!,
                is_default: t.is_default ?? false,
                charity_id: template.charity_id!,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

const settingsSchema = z.object({
  name: z.string().min(2),
  ein: z.string().nullable().optional(),
  address_line1: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  postal_code: z.string().nullable().optional(),
  default_tz: z.string(),
  resend_from_email: z.string().email().nullable().optional().or(z.literal('')),
  resend_from_name: z.string().nullable().optional(),
  receipt_signatory_name: z.string().nullable().optional(),
  receipt_disclaimer: z.string().nullable().optional(),
});

function SettingsCard({ charity }: { charity: Record<string, unknown> }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, formState: { isSubmitting, isDirty } } = useForm({
    defaultValues: charity as Record<string, string>,
  });

  const update = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const parsed = settingsSchema.partial().parse(values);
      const { error } = await supabase
        .from('charities')
        .update({ ...parsed, resend_from_email: parsed.resend_from_email || null })
        .eq('id', charity.id as string);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['charity', charity.id] }),
  });

  const headerId = `settings-header-${charity.id as string}`;
  const panelId = `settings-panel-${charity.id as string}`;

  return (
    <form
      className="card space-y-4"
      onSubmit={handleSubmit((v) => update.mutateAsync(v))}
    >
      <button
        type="button"
        id={headerId}
        aria-controls={panelId}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="-m-2 flex w-[calc(100%+1rem)] items-center justify-between gap-2 rounded-lg p-2 text-left hover:bg-ink-50 dark:hover:bg-ink-900 focus:outline-none focus:ring-2 focus:ring-accent/40"
      >
        <h2 className="font-semibold truncate">
          Settings - <span className="text-ink-600 dark:text-ink-300 font-normal">{charity.name as string}</span>
          {isDirty && <span className="ml-2 text-xs text-amber-600">unsaved</span>}
        </h2>
        <svg
          className={`h-4 w-4 shrink-0 text-ink-500 dark:text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div id={panelId} role="region" aria-labelledby={headerId} className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="field" {...register('name')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">EIN</label>
              <input className="field" {...register('ein')} />
            </div>
            <div>
              <label className="label">Time zone</label>
              <input className="field" {...register('default_tz')} />
            </div>
          </div>
          <div>
            <label className="label">Address</label>
            <input className="field" {...register('address_line1')} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">City</label>
              <input className="field" {...register('city')} />
            </div>
            <div>
              <label className="label">State</label>
              <input className="field" {...register('state')} />
            </div>
            <div>
              <label className="label">ZIP</label>
              <input className="field" {...register('postal_code')} />
            </div>
          </div>
          <div>
            <label className="label">Resend from email</label>
            <input className="field" type="email" {...register('resend_from_email')} />
          </div>
          <div>
            <label className="label">Resend from name</label>
            <input className="field" {...register('resend_from_name')} />
          </div>
          <div>
            <label className="label">Receipt signatory</label>
            <input className="field" {...register('receipt_signatory_name')} />
          </div>
          <div>
            <label className="label">Receipt disclaimer</label>
            <textarea className="field" rows={3} {...register('receipt_disclaimer')} />
          </div>
          {update.error && <p className="text-red-600 text-sm">{(update.error as Error).message}</p>}
          <button type="submit" className="btn-primary w-full" disabled={!isDirty || isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}
    </form>
  );
}

interface MemberRow {
  user_id: string;
  role: 'admin' | 'rep';
  invited_at: string | null;
  accepted_at: string | null;
  profiles: { email: string | null; full_name: string | null } | null;
}

function MembersSection({ charityId, canAdmin }: { charityId: string; canAdmin: boolean }) {
  const qc = useQueryClient();
  const members = useQuery({
    queryKey: ['members', charityId],
    queryFn: async (): Promise<MemberRow[]> => {
      const { data, error } = await supabase
        .from('charity_members')
        .select(`user_id, role, invited_at, accepted_at, profiles:user_id(email, full_name)`)
        .eq('charity_id', charityId);
      if (error) throw error;
      return (data ?? []) as unknown as MemberRow[];
    },
  });

  const changeRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: 'admin' | 'rep' }) => {
      const { error } = await supabase
        .from('charity_members')
        .update({ role })
        .eq('charity_id', charityId)
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', charityId] }),
  });

  const remove = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('charity_members')
        .delete()
        .eq('charity_id', charityId)
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', charityId] }),
  });

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Members</h2>
      {members.isLoading ? (
        <div className="text-ink-400 dark:text-ink-500 text-sm">Loading...</div>
      ) : (members.data ?? []).length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">No members yet.</p>
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800">
          {(members.data ?? []).map((m: MemberRow) => {
            const profile = m.profiles;
            return (
              <li key={m.user_id} className="py-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{profile?.full_name ?? profile?.email ?? m.user_id}</div>
                  <div className="text-xs text-ink-500 dark:text-ink-400 capitalize">{m.role}</div>
                </div>
                {canAdmin && (
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      className="bg-ink-100 dark:bg-ink-800 text-sm rounded-lg px-2 py-1"
                      value={m.role}
                      onChange={(e) => changeRole.mutate({ userId: m.user_id, role: e.target.value as 'admin' | 'rep' })}
                    >
                      <option value="rep">Rep</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      type="button"
                      className="text-red-600 text-sm"
                      onClick={() => {
                        if (confirm('Remove this member?')) remove.mutate(m.user_id);
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canAdmin && <InviteForm charityId={charityId} />}
    </section>
  );
}

function InviteForm({ charityId }: { charityId: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'rep'>('rep');
  const [message, setMessage] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => edgeFunctions.inviteUser({ email: email.trim().toLowerCase(), charity_id: charityId, role }),
    onSuccess: () => {
      setMessage(`Invited ${email}`);
      setEmail('');
      qc.invalidateQueries({ queryKey: ['invitations', charityId] });
      qc.invalidateQueries({ queryKey: ['members', charityId] });
    },
    onError: (err) => setMessage((err as Error).message),
  });

  return (
    <div className="border-t border-ink-100 dark:border-ink-800 pt-4 mt-2">
      <div className="text-sm font-semibold mb-2">Invite a new member</div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          className="field flex-1"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="person@example.org"
        />
        <select className="field sm:w-32" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'rep')}>
          <option value="rep">Rep</option>
          <option value="admin">Admin</option>
        </select>
        <button
          type="button"
          className="btn-primary sm:w-40"
          disabled={!email || invite.isPending}
          onClick={() => invite.mutate()}
        >
          {invite.isPending ? 'Inviting...' : 'Send invite'}
        </button>
      </div>
      {message && <p className="text-sm text-ink-500 dark:text-ink-400 mt-2">{message}</p>}
    </div>
  );
}

function InvitationsSection({ charityId }: { charityId: string }) {
  const qc = useQueryClient();
  const invitations = useQuery({
    queryKey: ['invitations', charityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitations')
        .select('id, email, role, created_at, expires_at, accepted_at')
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
        {pending.map((inv) => (
          <li key={inv.id} className="py-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium truncate">{inv.email}</div>
              <div className="text-xs text-ink-500 dark:text-ink-400 capitalize">
                {inv.role} - expires {new Date(inv.expires_at).toLocaleDateString()}
              </div>
            </div>
            <button
              type="button"
              className="text-red-600 text-sm"
              onClick={() => {
                if (confirm('Revoke this invitation?')) revoke.mutate(inv.id);
              }}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
