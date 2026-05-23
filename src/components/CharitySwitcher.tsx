import { useMyCharities } from '@/state/charities';
import { useActiveCharity } from '@/state/activeCharity';

export function CharitySwitcher() {
  const { data: charities, isLoading } = useMyCharities();
  const { activeCharityId, setActiveCharityId } = useActiveCharity();

  if (isLoading) {
    return <div className="text-sm text-ink-400 truncate">Loading...</div>;
  }

  if (!charities || charities.length === 0) {
    return <div className="text-sm text-ink-500 truncate">No charity yet</div>;
  }

  if (charities.length === 1) {
    return <div className="text-sm font-semibold truncate">{charities[0].name}</div>;
  }

  return (
    <select
      className="bg-transparent text-sm font-semibold focus:outline-none truncate max-w-[200px]"
      value={activeCharityId ?? ''}
      onChange={(e) => setActiveCharityId(e.target.value || null)}
      aria-label="Active charity"
    >
      {charities.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
