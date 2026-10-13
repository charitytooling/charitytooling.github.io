import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { PasswordCard } from '@/auth/PasswordCard';
import { BrandMark } from '@/components/BrandMark';
import { useProfile } from '@/state/profile';

// Landing page for the reset email (Supabase redirects here with a recovery
// session already established) and for the forced change after an admin set a
// temporary password (RequireAuth sends people here while
// profiles.must_change_password is true).
export function ResetPasswordPage() {
  const { session, user, loading } = useAuth();
  const navigate = useNavigate();
  const { data: profile } = useProfile();
  const forced = profile?.must_change_password === true;

  if (loading) return null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-ink-50 dark:bg-ink-950 px-6 safe-top safe-bottom">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <BrandMark className="mx-auto h-16 w-16 text-accent" />
          <h1 className="mt-4 text-2xl font-semibold">Choose a new password</h1>
          {user?.email && <p className="text-ink-500 dark:text-ink-400 text-sm">for {user.email}</p>}
        </div>

        {!session ? (
          <div className="card text-center space-y-3">
            <p className="text-base font-medium">This reset link is invalid or has expired.</p>
            <p className="text-sm text-ink-500 dark:text-ink-400">Links work for one hour and only once. Request a new one below.</p>
            <Link to="/forgot-password" className="btn-primary w-full">Send a new link</Link>
            <Link to="/sign-in" className="btn-ghost w-full">Back to sign in</Link>
          </div>
        ) : (
          <PasswordCard
            email={user?.email ?? ''}
            intro={forced ? 'You signed in with a temporary password. Choose your own to continue.' : 'Pick something at least 10 characters long. A short phrase works well.'}
            submitLabel="Save and sign in"
            onDone={() => navigate('/ledger', { replace: true })}
          />
        )}
      </div>
    </div>
  );
}
