import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from '@/components/BrandMark';
import { supabase } from '@/lib/supabase';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const target = new URL(window.location.origin);
      target.hash = '#/reset-password';
      const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: target.toString(),
      });
      // Same screen whether or not the address exists, so the form cannot be
      // used to find out who has an account.
      if (err && !/rate limit/i.test(err.message)) console.warn(err.message);
      if (err && /rate limit/i.test(err.message)) throw new Error('Too many requests. Try again in a few minutes.');
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-ink-50 dark:bg-ink-950 px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BrandMark className="mx-auto h-16 w-16 text-accent" />
          <h1 className="mt-4 text-2xl font-semibold">Reset your password</h1>
          <p className="text-ink-500 dark:text-ink-400 text-sm">We'll email you a link</p>
        </div>

        {sent ? (
          <div className="card space-y-3">
            <p className="text-base">Check your email.</p>
            <p className="text-sm text-ink-500 dark:text-ink-400">
              If there is an account for <span className="font-medium">{email}</span>, a reset link is on its way. It works for one hour.
            </p>
            <p className="text-sm text-ink-500 dark:text-ink-400">
              Can't get into that inbox? Ask your charity admin to send you a sign-in link instead.
            </p>
            <Link to="/sign-in" className="btn-ghost w-full">Back to sign in</Link>
          </div>
        ) : (
          <form className="card space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="label" htmlFor="fp-email">Email</label>
              <input id="fp-email" type="email" inputMode="email" autoComplete="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.org" />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" className="btn-primary w-full" disabled={submitting || !email}>
              {submitting ? 'Sending...' : 'Send reset link'}
            </button>
            <p className="text-center text-sm">
              <Link to="/sign-in" className="text-ink-500 dark:text-ink-400 hover:underline">Back to sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
