import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { useProfile } from '@/state/profile';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  const { data: profile } = useProfile();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-50 dark:bg-ink-950">
        <div className="text-ink-500 dark:text-ink-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (!session) {
    const redirect = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/sign-in?redirect=${redirect}`} replace />;
  }

  // An admin set a temporary password or sent a sign-in link: the person must
  // choose their own password before using the app.
  if (profile?.must_change_password && location.pathname !== '/reset-password') {
    return <Navigate to="/reset-password" replace />;
  }

  return <>{children}</>;
}
