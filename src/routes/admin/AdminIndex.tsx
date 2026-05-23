import { Link } from 'react-router-dom';
import { useIsSuperAdmin } from '@/state/profile';
import { useMyCharities } from '@/state/charities';

export function AdminIndex() {
  const isSuper = useIsSuperAdmin();
  const { data: charities, isLoading } = useMyCharities();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-ink-500 text-sm">
          {isSuper ? 'Super-admin: manage all charities and members.' : 'Manage charities you administer.'}
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Charities</h2>
          {isSuper && (
            <Link to="/admin/charities/new" className="text-accent text-sm font-medium">
              + New
            </Link>
          )}
        </div>
        {isLoading ? (
          <div className="text-ink-400 text-sm">Loading...</div>
        ) : !charities || charities.length === 0 ? (
          <div className="card">
            <p className="text-ink-500 text-sm">
              {isSuper
                ? 'No charities yet. Create one to get started.'
                : 'You have not been added to any charity yet.'}
            </p>
            {isSuper && (
              <Link to="/admin/charities/new" className="btn-primary mt-4 w-full">
                Create charity
              </Link>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {charities.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/admin/charities/${c.id}`}
                  className="card flex items-center justify-between hover:border-accent/40 transition"
                >
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-ink-500 capitalize">{c.role.replace('_', ' ')}</div>
                  </div>
                  <span className="text-ink-400">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
