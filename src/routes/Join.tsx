import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BrandMark } from '@/components/BrandMark';
import { edgeFunctions } from '@/lib/edgeFunctions';

const REASONS: Record<string, string> = {
  'not-found': 'That code is not valid. Check it with your charity admin.',
  used: 'That code has already been used. Ask your charity admin for a new one.',
  expired: 'That code has expired. Ask your charity admin for a new one.',
  revoked: 'That code was cancelled. Ask your charity admin for the current one.',
  'email-mismatch': 'That code was sent to a different email address.',
  'too-many-attempts': 'Too many tries. Wait a minute and try again.',
  'invalid-email': 'Enter a valid email address.',
};

function normalise(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.+)$/, '$1-$2').slice(0, 9);
}

export function JoinPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(normalise(params.get('code') ?? ''));
  const [check, setCheck] = useState<{ charity_name: string; role: string } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ existing: boolean; charity_name: string; role: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live check once the code looks complete, so the person sees which charity
  // they are joining before they submit.
  useEffect(() => {
    setCheck(null);
    setCheckError(null);
    if (code.length < 9) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await edgeFunctions.checkCode({ code });
        if (cancelled) return;
        if (r.ok) setCheck({ charity_name: r.charity_name, role: r.role });
        else setCheckError(REASONS[r.reason] ?? 'That code is not valid.');
      } catch {
        if (!cancelled) setCheckError('Could not check that code. Try again.');
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [code]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await edgeFunctions.joinWithCode({ code, email: email.trim().toLowerCase() });
      if (!r.ok) throw new Error(REASONS[r.reason] ?? 'Could not join with that code.');
      setDone({ existing: r.existing, charity_name: r.charity_name, role: r.role });
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
          <h1 className="mt-4 text-2xl font-semibold">Join your charity</h1>
          <p className="text-ink-500 dark:text-ink-400 text-sm">You need a code from your charity admin</p>
        </div>

        {done ? (
          <div className="card space-y-3">
            {done.existing ? (
              <>
                <p className="text-base font-medium">You're in.</p>
                <p className="text-sm text-ink-500 dark:text-ink-400">
                  Your existing account now belongs to <span className="font-medium">{done.charity_name}</span> as {done.role === 'admin' ? 'an admin' : 'a rep'}. Sign in to continue.
                </p>
                <Link to="/sign-in" className="btn-primary w-full">Sign in</Link>
              </>
            ) : (
              <>
                <p className="text-base font-medium">Check your email.</p>
                <p className="text-sm text-ink-500 dark:text-ink-400">
                  We sent a link to <span className="font-medium">{email}</span>. Tap it to finish joining <span className="font-medium">{done.charity_name}</span> as {done.role === 'admin' ? 'an admin' : 'a rep'} and choose your password.
                </p>
                <p className="text-xs text-ink-500 dark:text-ink-400">Nothing arrived after a few minutes? Check spam, or ask your admin to send the invite again.</p>
              </>
            )}
          </div>
        ) : (
          <form className="card space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="label" htmlFor="join-code">Invite code</label>
              <input id="join-code" className="field font-mono tracking-widest uppercase" value={code} onChange={(e) => setCode(normalise(e.target.value))} placeholder="ABCD-1234" autoCapitalize="characters" autoCorrect="off" spellCheck={false} required />
              {check && (
                <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
                  You'll join <span className="font-medium">{check.charity_name}</span> as {check.role === 'admin' ? 'an admin' : 'a rep'}.
                </p>
              )}
              {checkError && <p className="mt-2 text-sm text-red-600">{checkError}</p>}
            </div>
            <div>
              <label className="label" htmlFor="join-email">Email</label>
              <input id="join-email" type="email" inputMode="email" autoComplete="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.org" />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" className="btn-primary w-full" disabled={submitting || !check || !email}>
              {submitting ? 'Joining...' : 'Continue'}
            </button>
            <p className="text-center text-sm">
              <Link to="/sign-in" className="text-ink-500 dark:text-ink-400 hover:underline">Already have an account? Sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
