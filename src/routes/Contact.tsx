import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { displayName, useCustomer } from '@/state/customers';
import { useCreateNote, useFollowUps, useNotes } from '@/state/notes';
import { useProfile } from '@/state/profile';
import { useContactQueue } from '@/state/queue';
import { useActiveCharity } from '@/state/activeCharity';
import { NoteForm } from './contact/NoteForm';
import { NoteList } from './contact/NoteList';
import { FollowUpList } from './contact/FollowUpList';
import { EmailComposer } from './contact/EmailComposer';
import { DonationModal } from './contact/DonationModal';
import { DonationsSection } from './contact/DonationsSection';
import { ContactNav } from './contact/ContactNav';

export function ContactPage() {
  const { id } = useParams<{ id?: string }>();
  const customer = useCustomer(id);
  const notes = useNotes(id);
  const followUps = useFollowUps(id);
  const createNote = useCreateNote();
  const [composerOpen, setComposerOpen] = useState(false);
  const [donationOpen, setDonationOpen] = useState(false);

  if (!id) {
    return <ContactLanding />;
  }

  if (customer.isLoading) {
    return <div className="mx-auto max-w-3xl px-4 py-6 text-ink-400">Loading...</div>;
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 space-y-4">
      <header className="card">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold truncate">{name}</h1>
            <div className="text-sm text-ink-500 truncate">
              {c.email && (
                <a href={`mailto:${c.email}`} className="hover:text-accent">{c.email}</a>
              )}
              {c.email && c.phone && ' - '}
              {c.phone && (
                <a href={`tel:${c.phone}`} className="hover:text-accent">{c.phone}</a>
              )}
            </div>
            {c.website && (
              <div className="text-xs text-ink-500 truncate">
                <a href={ensureProtocol(c.website)} target="_blank" rel="noreferrer" className="hover:text-accent">
                  {c.website}
                </a>
              </div>
            )}
          </div>
          <Link to={`/update?id=${c.id}`} className="text-sm text-ink-500">Edit</Link>
        </div>
        <div className="text-xs text-ink-400 mt-2">
          {c.last_contacted_at
            ? `Last contacted ${new Date(c.last_contacted_at).toLocaleDateString()} (${relativeDays(c.last_contacted_at)})`
            : 'Never contacted'}
        </div>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <a
          className="btn-primary"
          href={c.phone ? `tel:${c.phone}` : undefined}
          aria-disabled={!c.phone}
          onClick={(e) => {
            if (!c.phone) {
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
          disabled={!c.email}
        >
          Email
        </button>
        <button type="button" className="btn-primary" onClick={() => setDonationOpen(true)}>
          Donation
        </button>
      </div>

      <FollowUpList customerId={c.id} charityId={c.charity_id} followUps={followUps.data ?? []} />

      <DonationsSection customer={c} />

      <section className="card space-y-3">
        <h2 className="font-semibold">Log a note</h2>
        <NoteForm customerId={c.id} charityId={c.charity_id} />
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">History ({(notes.data ?? []).length})</h2>
        <NoteList notes={notes.data ?? []} loading={notes.isLoading} />
      </section>

      <ContactNav currentId={c.id} charityId={c.charity_id} />

      {composerOpen && c.email && (
        <EmailComposer
          customer={c}
          onClose={() => setComposerOpen(false)}
        />
      )}

      {donationOpen && (
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
    return <div className="mx-auto max-w-3xl px-4 py-6 text-ink-400">Loading...</div>;
  }
  if (queue.length > 0) {
    return <Navigate to={`/contact/${queue[0].id}`} replace />;
  }
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-semibold">Contact</h1>
      <p className="mt-2 text-ink-500 text-sm">
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
