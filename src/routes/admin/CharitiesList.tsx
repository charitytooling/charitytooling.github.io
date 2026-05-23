import { Link } from 'react-router-dom';
import { useMyCharities } from '@/state/charities';
import { useIsSuperAdmin } from '@/state/profile';

export function CharitiesList() {
  const { data: charities, isLoading } = useMyCharities();
  const isSuper = useIsSuperAdmin();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Charities</h1>
        {isSuper && (
          <Link to="/admin/charities/new" className="btn-primary">
            + New
          </Link>
        )}
      </div>
      {isLoading ? (
        <div className="text-ink-400 dark:text-ink-500 text-sm">Loading...</div>
      ) : (
        <ul className="space-y-2">
          {(charities ?? []).map((c) => (
            <li key={c.id}>
              <Link to={`/admin/charities/${c.id}`} className="card block">
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-ink-500 dark:text-ink-400 capitalize">
                  {c.role.replace('_', ' ')} - {c.default_tz}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
