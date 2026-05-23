import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { supabase } from '@/lib/supabase';

export function SignIn() {
  const { session, loading } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return null;
  if (session) {
    const redirect = params.get('redirect');
    return <Navigate to={redirect ? decodeURIComponent(redirect) : '/ledger'} replace />;
  }

  async function sendMagicLink() {
    setError(null);
    setSubmitting(true);
    try {
      // Preserve any deep-link redirect through the magic-link round trip by
      // tacking it onto the hash route. Supabase appends `?code=...` to the
      // base URL (PKCE flow); supabase-js exchanges + strips the code on load
      // while leaving the hash intact, so this component re-renders with a
      // valid session AND the original `redirect` query in the URL.
      const redirect = params.get('redirect');
      const target = new URL(window.location.origin);
      if (redirect) {
        target.hash = `#/sign-in?redirect=${redirect}`;
      }
      const { error: err } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: target.toString(),
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

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw err;
      // AuthProvider's onAuthStateChange will fire; the `if (session)` guard
      // above then Navigates to /ledger or the `?redirect=` target.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-ink-50 dark:bg-ink-950 px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/icon.svg" alt="" className="mx-auto h-16 w-16" />
          <h1 className="mt-4 text-2xl font-semibold">CharityTooling</h1>
          <p className="text-ink-500 dark:text-ink-400 text-sm">Sign in to continue</p>
        </div>

        {sent ? (
          <div className="card text-center">
            <p className="text-base">Check your email for a magic link.</p>
            <p className="mt-2 text-sm text-ink-500 dark:text-ink-400">
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
          <form className="card space-y-4" onSubmit={signInWithPassword}>
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

            <button
              type="button"
              className="btn-primary w-full"
              onClick={sendMagicLink}
              disabled={submitting || !email}
            >
              {submitting ? 'Sending...' : 'Send magic link'}
            </button>

            <div className="relative my-2">
              <div className="absolute inset-x-0 top-1/2 h-px bg-ink-100 dark:bg-ink-800" />
              <div className="relative flex justify-center">
                <span className="bg-white dark:bg-ink-900 px-3 text-xs text-ink-500 dark:text-ink-400 uppercase">or</span>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={submitting || !email || !password}
            >
              {submitting ? 'Signing in...' : 'Sign in'}
            </button>

            {error && (
              <p className="text-sm text-red-600">
                {error}
                <br />
                <span className="text-ink-500 dark:text-ink-400">
                  This app is invite-only. If you haven't received an invitation, ask your charity admin.
                </span>
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
