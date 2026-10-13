import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { BrandMark } from '@/components/BrandMark';
import { PasswordCard } from '@/auth/PasswordCard';
import { useProfile } from '@/state/profile';

export function WelcomePage() {
  const { session, user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { data: profile } = useProfile();
  const mustChange = profile?.must_change_password === true;

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
          intro={mustChange ? <>Welcome back{user?.email ? <>, <span className="font-medium">{user.email}</span></> : null}. Choose a new password to keep this account yours.</> : undefined}
          onDone={() => navigate('/ledger', { replace: true })}
          onSkip={mustChange ? undefined : () => navigate('/ledger', { replace: true })}
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
