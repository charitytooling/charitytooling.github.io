import { Navigate, Route, Routes } from 'react-router-dom';
import { useIsAnyCharityAdmin, useIsSuperAdmin } from '@/state/profile';
import { AdminIndex } from './admin/AdminIndex';
import { CharitiesList } from './admin/CharitiesList';
import { CharityNew } from './admin/CharityNew';
import { CharityDetail } from './admin/CharityDetail';

export function AdminPage() {
  const isAdmin = useIsAnyCharityAdmin();
  const isSuper = useIsSuperAdmin();

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="mt-2 text-ink-500 dark:text-ink-400 text-sm">You do not have admin access to any charity.</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route index element={<AdminIndex />} />
      <Route path="charities" element={<CharitiesList />} />
      <Route
        path="charities/new"
        element={isSuper ? <CharityNew /> : <Navigate to="/admin/charities" replace />}
      />
      <Route path="charities/:id" element={<CharityDetail />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}
