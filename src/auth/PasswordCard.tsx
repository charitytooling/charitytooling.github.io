import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';

// Shared "choose a password" form used by Welcome (after an invite or an
// admin's sign-in link), Reset password (after a self-serve reset email) and
// the forced change after a temporary password. On success it clears
// profiles.must_change_password so RequireAuth stops redirecting here.
export function PasswordCard({
  email,
  intro,
  submitLabel = 'Set password and continue',
  onDone,
  onSkip,
}: {
  email: string;
  intro?: React.ReactNode;
  submitLabel?: string;
  onDone: () => void;
  onSkip?: () => void;
}) {
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pwd.length < 10) {
      setError('Use at least 10 characters. A short phrase works well.');
      return;
    }
    if (pwd !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const { data: userData, error: err } = await supabase.auth.updateUser({ password: pwd });
      if (err) throw err;
      const id = userData.user?.id;
      if (id) await supabase.from('profiles').update({ must_change_password: false }).eq('id', id);
      onDone();
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof Error ? err.message : 'Could not set password.');
    }
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <div>
        <p className="text-sm text-ink-700 dark:text-ink-200">
          {intro ?? (
            <>
              You're signed in{email ? <> as <span className="font-medium">{email}</span></> : null}.
              Set a password to make signing in easier next time. You can also keep using magic links.
            </>
          )}
        </p>
      </div>

      <div>
        <label className="label" htmlFor="pw-new">New password</label>
        <input id="pw-new" type="password" autoComplete="new-password" minLength={10} className="field" value={pwd} onChange={(e) => setPwd(e.target.value)} required />
      </div>

      <div>
        <label className="label" htmlFor="pw-confirm">Confirm password</label>
        <input id="pw-confirm" type="password" autoComplete="new-password" minLength={10} className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" className="btn-primary w-full" disabled={submitting || !pwd || !confirm}>
        {submitting ? 'Saving...' : submitLabel}
      </button>

      {onSkip && (
        <>
          <button type="button" className="btn-ghost w-full" onClick={onSkip} disabled={submitting}>Skip for now</button>
          <p className="text-xs text-ink-500 dark:text-ink-400 text-center">You can set a password later in Settings.</p>
        </>
      )}
    </form>
  );
}
