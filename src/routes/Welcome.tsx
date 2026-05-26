import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { BrandMark } from '@/components/BrandMark';
import { supabase } from '@/lib/supabase';

export function WelcomePage() {
  const { session, user, loading, signOut } = useAuth();
  const navigate = useNavigate();

  if (loading) return null;

  if (!session) {
    return (
      <Shell>
        <div className="card text-center space-y-3">
          <p className="text-base font-medium">
            Your invite link is invalid or expired.
          </p>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Ask your charity admin to send a new invitation, or sign in below if you
            already have an account.
          </p>
          <Link to="/sign-in" className="btn-primary w-full">
            Go to sign in
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-4">
        <PasswordCard
          email={user?.email ?? ''}
          onDone={() => navigate('/ledger', { replace: true })}
          onSkip={() => navigate('/ledger', { replace: true })}
        />
        <div className="text-center">
          <button
            type="button"
            onClick={async () => {
              await signOut();
              navigate('/sign-in', { replace: true });
            }}
            className="text-xs text-ink-500 dark:text-ink-400 hover:text-ink-800 dark:hover:text-ink-100 underline-offset-2 hover:underline"
          >
            Not you? Sign out
          </button>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-ink-50 dark:bg-ink-950 px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BrandMark className="mx-auto h-16 w-16 text-accent" />
          <h1 className="mt-4 text-2xl font-semibold">Welcome to CharityTooling</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

function PasswordCard({
  email,
  onDone,
  onSkip,
}: {
  email: string;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pwd.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (pwd !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: pwd });
      if (err) throw err;
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
          You're signed in{email ? <> as <span className="font-medium">{email}</span></> : null}.
          Set a password to make signing in easier next time. You can also keep using
          magic links.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="welcome-password">
          New password
        </label>
        <input
          id="welcome-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          className="field"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="welcome-confirm">
          Confirm password
        </label>
        <input
          id="welcome-confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
          className="field"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        className="btn-primary w-full"
        disabled={submitting || !pwd || !confirm}
      >
        {submitting ? 'Saving...' : 'Set password and continue'}
      </button>

      <button
        type="button"
        className="btn-ghost w-full"
        onClick={onSkip}
        disabled={submitting}
      >
        Skip for now
      </button>

      <p className="text-xs text-ink-500 dark:text-ink-400 text-center">
        You can set a password later in Settings.
      </p>
    </form>
  );
}
