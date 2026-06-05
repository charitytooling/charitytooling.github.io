import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  displayName,
  hasAnyInfo,
  primaryContact,
  sortedContacts,
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
import { useIsCharityAdmin, useIsSuperAdmin, useProfile } from '@/state/profile';
import { useAuth } from '@/auth/AuthProvider';
import { useContactQueue } from '@/state/queue';
import { useActiveCharity } from '@/state/activeCharity';
import { useSetStickyCustomer, useStickyCustomer } from '@/state/stickyCustomer';
import { NoteForm } from './contact/NoteForm';
import { NoteList } from './contact/NoteList';
import { FollowUpList } from './contact/FollowUpList';
import { EmailComposer } from './contact/EmailComposer';
import { DonationModal } from './contact/DonationModal';
import { DonationsSection } from './contact/DonationsSection';
import { ContactNav } from './contact/ContactNav';
import { CompanyOverview } from './contact/CompanyOverview';
import { CallScriptModal } from './contact/CallScriptModal';
import { FaqModal } from './contact/FaqModal';
import { ArchiveWithNoteModal } from './contact/ArchiveWithNoteModal';
import { scrollAppToTop } from '@/lib/scrollToTop';

export function ContactPage() {
  const { id } = useParams<{ id?: string }>();
  const customer = useCustomer(id);
  const notes = useNotes(id);
  const followUps = useFollowUps(id);
  const createNote = useCreateNote();
  const isSuper = useIsSuperAdmin();
  const { user } = useAuth();
  // Pulled before any early return so the hook order stays stable while
  // customer.data is undefined. useIsCharityAdmin tolerates a null
  // charityId (returns false for non-supers) so this is safe to call
  // before customer.data resolves.
  const isCharityAdmin = useIsCharityAdmin(customer.data?.charity_id ?? null);
  const navigate = useNavigate();
  const setSticky = useSetStickyCustomer();
  const [composerOpen, setComposerOpen] = useState(false);
  const [donationOpen, setDonationOpen] = useState(false);
  const [newFollowUpOpen, setNewFollowUpOpen] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);
  const [archiveNoteOpen, setArchiveNoteOpen] = useState(false);
  // Pulled at the top level so it stays in the same hook-call order across
  // renders (customer.data and the early returns below depend on it). The
  // hook tolerates a null charityId by short-circuiting to an empty queue.
  const queue = useContactQueue(customer.data?.charity_id ?? null);

  // The hook signature requires an id, but the buttons that call its
  // mutations only render once we have customer.data. Empty-string sentinel
  // keeps the hook order stable while id is undefined.
  const restore = useRestoreCustomer(id ?? '');
  const hardDelete = useDeleteCustomer(id ?? '');

  const loadedId = customer.data?.id ?? null;
  useEffect(() => {
    if (loadedId) setSticky(loadedId);
  }, [loadedId, setSticky]);

  // Snap the scroll container back to the top whenever the active customer
  // changes (Next click, archive-then-jump, direct URL nav, etc.) so the
  // user lands at the header of the new card instead of staying scrolled
  // halfway down the previous one.
  useEffect(() => {
    if (loadedId) scrollAppToTop();
  }, [loadedId]);

  // If the customer in the URL no longer exists (e.g. sticky points at a
  // deleted row), drop the sticky so the next landing falls back to the queue
  // head instead of looping on a dead id.
  useEffect(() => {
    if (customer.error) setSticky(null);
  }, [customer.error, setSticky]);

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
  // Hide fully-empty placeholder contacts (no name, email, phone, or note) so
  // the People card doesn't surface '(1)' / '(unnamed)' for nothing. The DB
  // rows are untouched -- this is display-only, so primaryContact() and the
  // donation-flow contact picker still see the full set.
  const allContacts = sortedContacts(c).filter(hasAnyInfo);
  const followUpList = followUps.data ?? [];
  // Hide the Follow-ups card when there is nothing to show, unless the user
  // is actively opening a brand-new follow-up via the shortcut next to the
  // Log a note header.
  const showFollowUpsCard = followUpList.length > 0 || newFollowUpOpen;

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
      setSticky(null);
      navigate('/ledger');
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 space-y-4">
      <header className="card">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-2xl font-semibold break-words">
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent(name)}`}
                target="_blank"
                rel="noopener noreferrer"
                title={`Search Google for "${name}"`}
                className="underline decoration-ink-300 decoration-dotted underline-offset-4 hover:decoration-accent dark:decoration-ink-600"
              >
                {name}
              </a>
            </h1>
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
        <CompanyOverview customer={c} />
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-xs text-ink-400 dark:text-ink-500 min-w-0 truncate">
            {c.last_contacted_at
              ? `Last contacted ${new Date(c.last_contacted_at).toLocaleDateString()} (${relativeDays(c.last_contacted_at)})`
              : 'Never contacted'}
          </div>
          {!isArchived && (
            <button
              type="button"
              onClick={() => setArchiveNoteOpen(true)}
              className="text-xs text-accent hover:underline shrink-0"
            >
              Archive & leave note
            </button>
          )}
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
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-ghost" onClick={() => setScriptOpen(true)}>
              Call script
            </button>
            <button type="button" className="btn-ghost" onClick={() => setFaqOpen(true)}>
              FAQ
            </button>
          </div>
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

          {showFollowUpsCard && (
            <FollowUpList
              customerId={c.id}
              charityId={c.charity_id}
              followUps={followUpList}
              showNew={newFollowUpOpen}
              onShowNewChange={setNewFollowUpOpen}
            />
          )}
        </>
      )}

      <DonationsSection customer={c} />

      {!isArchived && (
        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Log a note</h2>
            {!showFollowUpsCard && (
              <button
                type="button"
                onClick={() => setNewFollowUpOpen(true)}
                className="text-accent text-sm"
              >
                + Follow-up
              </button>
            )}
          </div>
          <NoteForm customerId={c.id} charityId={c.charity_id} />
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold">History ({(notes.data ?? []).length})</h2>
        {notes.isError ? (
          // Surface load failures inline so silent regressions like the
          // PGRST200 embed bug (notes_created_by_profile_fkey) are obvious
          // instead of looking like an empty list.
          <p className="text-sm text-red-600">
            Could not load notes.{' '}
            <button
              type="button"
              className="text-accent underline"
              onClick={() => notes.refetch()}
            >
              Retry
            </button>
            <span className="ml-2 text-xs text-ink-500 dark:text-ink-400">
              ({(notes.error as Error)?.message ?? 'unknown error'})
            </span>
          </p>
        ) : (
          <NoteList
            notes={notes.data ?? []}
            loading={notes.isLoading}
            userId={user?.id ?? null}
            isAdmin={isCharityAdmin}
            customerId={c.id}
          />
        )}
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

      {scriptOpen && !isArchived && (
        <CallScriptModal
          customerId={c.id}
          charityId={c.charity_id}
          onClose={() => setScriptOpen(false)}
        />
      )}

      {faqOpen && !isArchived && (
        <FaqModal charityId={c.charity_id} onClose={() => setFaqOpen(false)} />
      )}

      {archiveNoteOpen && !isArchived && (
        <ArchiveWithNoteModal
          customer={c}
          onClose={() => setArchiveNoteOpen(false)}
          onArchived={() => {
            // Capture the next queue id BEFORE invalidations land so we
            // can hand the user straight to the next customer instead of
            // bouncing through the /contact landing redirect. The queue
            // value at this moment still includes c (archive only just
            // resolved); use indexOf+1 the same way ContactNav does.
            const idx = queue.findIndex((q) => q.id === c.id);
            const nextId =
              idx !== -1 && idx < queue.length - 1 ? queue[idx + 1].id : null;
            setArchiveNoteOpen(false);
            setSticky(null);
            if (nextId) navigate(`/contact/${nextId}`);
            else navigate('/contact');
          }}
        />
      )}
    </div>
  );
}

function ContactLanding() {
  const { activeCharityId } = useActiveCharity();
  const profile = useProfile();
  const queue = useContactQueue(activeCharityId);
  const sticky = useStickyCustomer();

  // Sticky wins: if a customer was last viewed in this charity, jump straight
  // back there before consulting the queue head.
  if (sticky) {
    return <Navigate to={`/contact/${sticky}`} replace />;
  }

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
