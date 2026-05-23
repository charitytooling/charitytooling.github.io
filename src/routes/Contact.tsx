import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  displayName,
  primaryContact,
  sortedContacts,
  useArchiveCustomer,
  useCustomer,
  useDeleteCustomer,
  useRestoreCustomer,
  type CustomerContactRow,
  type CustomerRow,
} from '@/state/customers';
import { useCreateNote, useFollowUps, useNotes } from '@/state/notes';
import {
  useDeleteContact,
  useSetPrimaryContact,
} from '@/state/contacts';
import { useIsSuperAdmin, useProfile } from '@/state/profile';
import { useContactQueue } from '@/state/queue';
import { useActiveCharity } from '@/state/activeCharity';
import { NoteForm } from './contact/NoteForm';
import { NoteList } from './contact/NoteList';
import { FollowUpList } from './contact/FollowUpList';
import { EmailComposer } from './contact/EmailComposer';
import { DonationModal } from './contact/DonationModal';
import { DonationsSection } from './contact/DonationsSection';
import { ContactNav } from './contact/ContactNav';
import { CompanyOverview } from './contact/CompanyOverview';

export function ContactPage() {
  const { id } = useParams<{ id?: string }>();
  const customer = useCustomer(id);
  const notes = useNotes(id);
  const followUps = useFollowUps(id);
  const createNote = useCreateNote();
  const isSuper = useIsSuperAdmin();
  const navigate = useNavigate();
  const [composerOpen, setComposerOpen] = useState(false);
  const [donationOpen, setDonationOpen] = useState(false);

  // The hook signature requires an id, but the buttons that call its
  // mutations only render once we have customer.data. Empty-string sentinel
  // keeps the hook order stable while id is undefined.
  const archive = useArchiveCustomer(id ?? '');
  const restore = useRestoreCustomer(id ?? '');
  const hardDelete = useDeleteCustomer(id ?? '');

  if (!id) {
    return <ContactLanding />;
  }

  if (customer.isLoading) {
    return <div className="mx-auto max-w-3xl px-4 py-6 text-ink-400 dark:text-ink-500">Loading...</div>;
  }
  if (customer.error || !customer.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 text-red-600">
        {(customer.error as Error)?.message ?? 'Customer not found.'}
      </div>
    );
  }

  const c = customer.data;
  const name = displayName(c);
  const isArchived = c.archived_at != null;
  const primary = primaryContact(c);
  const primaryEmail = primary?.email ?? null;
  const primaryPhone = primary?.phone ?? null;
  const allContacts = sortedContacts(c);

  async function onArchive() {
    if (!confirm(`Archive ${name}? They will be hidden from the ledger but kept for audit. You can restore later.`)) return;
    try {
      await archive.mutateAsync();
      navigate('/contact');
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function onRestore() {
    try {
      await restore.mutateAsync();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function onDeletePermanently() {
    if (
      !confirm(
        `Permanently delete ${name}? This cannot be undone. All notes, follow-ups, and donations for this customer will be deleted.`,
      )
    )
      return;
    try {
      await hardDelete.mutateAsync();
      navigate('/ledger');
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 space-y-4">
      <header className="card">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-2xl font-semibold truncate">{name}</h1>
              {isArchived && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide bg-ink-100 dark:bg-ink-800 text-ink-500 dark:text-ink-400 px-2 py-0.5 rounded-full">
                  Archived
                </span>
              )}
            </div>
            <div className="text-sm text-ink-500 dark:text-ink-400 truncate">
              {primaryEmail && (
                <a href={`mailto:${primaryEmail}`} className="hover:text-accent">{primaryEmail}</a>
              )}
              {primaryEmail && primaryPhone && ' - '}
              {primaryPhone && (
                <a href={`tel:${primaryPhone}`} className="hover:text-accent">{primaryPhone}</a>
              )}
            </div>
            {c.website && (
              <div className="text-xs text-ink-500 dark:text-ink-400 truncate">
                <a href={ensureProtocol(c.website)} target="_blank" rel="noreferrer" className="hover:text-accent">
                  {c.website}
                </a>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isArchived && (
              <button
                type="button"
                onClick={onArchive}
                disabled={archive.isPending}
                className="text-xs text-ink-500 dark:text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
              >
                Archive
              </button>
            )}
            <Link to={`/update?id=${c.id}`} className="text-sm text-ink-500 dark:text-ink-400">Edit</Link>
          </div>
        </div>
        <CompanyOverview customer={c} />
        <div className="text-xs text-ink-400 dark:text-ink-500 mt-3">
          {c.last_contacted_at
            ? `Last contacted ${new Date(c.last_contacted_at).toLocaleDateString()} (${relativeDays(c.last_contacted_at)})`
            : 'Never contacted'}
        </div>
      </header>

      {isArchived ? (
        <section className="card bg-ink-50 dark:bg-ink-950 border-ink-200 dark:border-ink-700">
          <p className="text-sm text-ink-700 dark:text-ink-200">
            Archived on {new Date(c.archived_at as string).toLocaleDateString()}. Restore to edit.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={onRestore}
              disabled={restore.isPending}
            >
              {restore.isPending ? 'Restoring...' : 'Restore'}
            </button>
            {isSuper && (
              <button
                type="button"
                className="btn-ghost flex-1 text-red-600"
                onClick={onDeletePermanently}
                disabled={hardDelete.isPending}
              >
                {hardDelete.isPending ? 'Deleting...' : 'Delete permanently'}
              </button>
            )}
          </div>
        </section>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <a
              className="btn-primary"
              href={primaryPhone ? `tel:${primaryPhone}` : undefined}
              aria-disabled={!primaryPhone}
              onClick={(e) => {
                if (!primaryPhone) {
                  e.preventDefault();
                  return;
                }
                // Fire-and-forget so the dialer launch is not blocked on the
                // round-trip. useCreateNote stamps last_contacted_at and
                // invalidates the notes/customer caches on success, so the
                // History panel updates when the user returns.
                createNote.mutate({
                  charity_id: c.charity_id,
                  customer_id: c.id,
                  kind: 'call',
                  body: 'Initiated call',
                });
              }}
            >
              Call
            </a>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setComposerOpen(true)}
              disabled={!primaryEmail}
            >
              Email
            </button>
            <button type="button" className="btn-primary" onClick={() => setDonationOpen(true)}>
              Donation
            </button>
          </div>

          <PeopleSection customer={c} contacts={allContacts} />

          <FollowUpList customerId={c.id} charityId={c.charity_id} followUps={followUps.data ?? []} />
        </>
      )}

      <DonationsSection customer={c} />

      {!isArchived && (
        <section className="card space-y-3">
          <h2 className="font-semibold">Log a note</h2>
          <NoteForm customerId={c.id} charityId={c.charity_id} />
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold">History ({(notes.data ?? []).length})</h2>
        <NoteList notes={notes.data ?? []} loading={notes.isLoading} />
      </section>

      <ContactNav currentId={c.id} charityId={c.charity_id} />

      {composerOpen && primaryEmail && !isArchived && (
        <EmailComposer
          customer={c}
          onClose={() => setComposerOpen(false)}
        />
      )}

      {donationOpen && !isArchived && (
        <DonationModal
          customer={c}
          onClose={() => setDonationOpen(false)}
        />
      )}
    </div>
  );
}

function ContactLanding() {
  const { activeCharityId } = useActiveCharity();
  const profile = useProfile();
  const queue = useContactQueue(activeCharityId);

  // Gate the redirect on the profile load so we honor the user's saved sort
  // preference instead of jumping to the default-sorted first card and then
  // re-routing once the profile finishes loading.
  if (!profile.isSuccess) {
    return <div className="mx-auto max-w-3xl px-4 py-6 text-ink-400 dark:text-ink-500">Loading...</div>;
  }
  if (queue.length > 0) {
    return <Navigate to={`/contact/${queue[0].id}`} replace />;
  }
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold">Contact</h1>
      <p className="mt-2 text-ink-500 dark:text-ink-400 text-sm">
        No customers to contact. Add one in the{' '}
        <Link className="text-accent" to="/ledger">Ledger</Link>.
      </p>
    </div>
  );
}

function ensureProtocol(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function PeopleSection({
  customer,
  contacts,
}: {
  customer: CustomerRow;
  contacts: CustomerContactRow[];
}) {
  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">People ({contacts.length})</h2>
        <Link to={`/update?id=${customer.id}`} className="text-xs text-ink-500 dark:text-ink-400 hover:text-accent">
          Edit
        </Link>
      </div>
      {contacts.length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">
          No contacts yet.{' '}
          <Link to={`/update?id=${customer.id}`} className="text-accent">
            Add one
          </Link>{' '}
          to enable Call and Email.
        </p>
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-ink-800 -mx-4 px-4">
          {contacts.map((p) => (
            <PersonRow key={p.id} person={p} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PersonRow({ person }: { person: CustomerContactRow }) {
  const setPrimary = useSetPrimaryContact();
  const del = useDeleteContact();
  const name = `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || '(unnamed)';

  async function onMakePrimary() {
    try {
      await setPrimary.mutateAsync({ id: person.id, customer_id: person.customer_id });
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function onDelete() {
    if (!confirm(`Delete ${name}?`)) return;
    try {
      await del.mutateAsync({ id: person.id, customer_id: person.customer_id });
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <li className="py-3 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="font-medium truncate">{name}</p>
          {person.is_primary && (
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
              Primary
            </span>
          )}
        </div>
        <div className="text-sm text-ink-500 dark:text-ink-400 truncate">
          {person.email && (
            <a href={`mailto:${person.email}`} className="hover:text-accent">
              {person.email}
            </a>
          )}
          {person.email && person.phone && ' - '}
          {person.phone && (
            <a href={`tel:${person.phone}`} className="hover:text-accent">
              {person.phone}
            </a>
          )}
        </div>
        {person.note && (
          <p className="text-xs text-ink-500 dark:text-ink-400 mt-1 whitespace-pre-wrap">{person.note}</p>
        )}
      </div>
      <div className="flex flex-col gap-1 shrink-0 text-xs">
        {!person.is_primary && (
          <button
            type="button"
            className="text-ink-500 dark:text-ink-400 hover:text-accent disabled:opacity-50"
            onClick={onMakePrimary}
            disabled={setPrimary.isPending}
          >
            Make primary
          </button>
        )}
        <button
          type="button"
          className="text-ink-500 dark:text-ink-400 hover:text-red-600 disabled:opacity-50"
          onClick={onDelete}
          disabled={del.isPending}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function relativeDays(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  // Zero out local time-of-day on both sides so "today" matches the calendar
  // day the user sees, not a strict 24-hour ms window.
  then.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  // Math.round (not floor) absorbs the +/- 1 hour DST jump near boundaries.
  const diff = Math.round((now.getTime() - then.getTime()) / 86_400_000);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff > 1) return `${diff} days ago`;
  if (diff === -1) return 'tomorrow';
  return `in ${Math.abs(diff)} days`;
}
