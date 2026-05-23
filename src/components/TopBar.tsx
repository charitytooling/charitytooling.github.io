import { Link } from 'react-router-dom';
import { useActiveCharity } from '@/state/activeCharity';
import { CharitySwitcher } from './CharitySwitcher';

export function TopBar() {
  const { activeCharityId } = useActiveCharity();

  return (
    <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-ink-100">
      <div className="mx-auto max-w-3xl flex items-center justify-between px-4 py-3 safe-top">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/icon.svg" alt="" className="h-7 w-7 shrink-0" />
          <CharitySwitcher />
        </div>
        <Link
          to="/settings"
          className="rounded-lg p-2 text-ink-600 hover:bg-ink-100"
          aria-label="Settings"
        >
          <SettingsIcon className="h-5 w-5" />
        </Link>
      </div>
      {!activeCharityId && (
        <div className="bg-amber-50 text-amber-900 text-xs px-4 py-2 text-center border-t border-amber-100">
          No charity selected. An admin must invite you, or you can create one from the Admin tab.
        </div>
      )}
    </header>
  );
}

function SettingsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06A2 2 0 1 1 4.13 16.93l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1.04H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 7.07 4.13l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06A2 2 0 1 1 19.87 7.07l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" />
    </svg>
  );
}
