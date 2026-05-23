import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { supabase } from '@/lib/supabase';

export function SignIn() {
  const { session, loading } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return null;
  if (session) {
    const redirect = params.get('redirect');
    return <Navigate to={redirect ? decodeURIComponent(redirect) : '/ledger'} replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email,
        options: {
          // Sign-up is disabled in the Supabase dashboard; users only get in
          // via the `invite-user` Edge Function which creates them server-side.
          shouldCreateUser: false,
          emailRedirectTo: window.location.origin,
        },
      });
      if (err) throw err;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-ink-50 px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/icon.svg" alt="" className="mx-auto h-16 w-16" />
          <h1 className="mt-4 text-2xl font-semibold">CharityTooling</h1>
          <p className="text-ink-500 text-sm">Sign in to continue</p>
        </div>

        {sent ? (
          <div className="card text-center">
            <p className="text-base">Check your email for a magic link.</p>
            <p className="mt-2 text-sm text-ink-500">
              The link will sign you in to this device. It expires in one hour.
            </p>
            <button
              type="button"
              className="btn-ghost mt-6 w-full"
              onClick={() => {
                setSent(false);
                setEmail('');
              }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form className="card space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.org"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600">
                {error}
                <br />
                <span className="text-ink-500">
                  This app is invite-only. If you haven't received an invitation, ask your charity admin.
                </span>
              </p>
            )}
            <button type="submit" className="btn-primary w-full" disabled={submitting || !email}>
              {submitting ? 'Sending...' : 'Send magic link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
