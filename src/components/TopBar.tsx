import { NavLink } from 'react-router-dom';
import { useActiveCharity } from '@/state/activeCharity';
import { useNextFollowUpDays } from '@/state/notes';
import { BrandMark } from './BrandMark';
import { CharitySwitcher } from './CharitySwitcher';

export function TopBar() {
  const { activeCharityId } = useActiveCharity();
  const { data: next } = useNextFollowUpDays(activeCharityId);

  return (
    <header className="sticky top-0 z-20 bg-white/90 dark:bg-ink-900/90 backdrop-blur border-b border-ink-100 dark:border-ink-800">
      <div className="mx-auto max-w-3xl flex items-center justify-between px-4 py-3 safe-top">
        <div className="flex items-center gap-2 min-w-0">
          <NavLink
            to="/me"
            aria-label="My activity"
            className={({ isActive }) =>
              [
                'rounded-lg p-1 shrink-0 hover:bg-ink-100 dark:hover:bg-ink-800',
                isActive ? 'ring-2 ring-accent/40' : '',
              ].join(' ')
            }
          >
            <BrandMark className="h-7 w-7 text-accent" />
          </NavLink>
          <CharitySwitcher />
        </div>
        <div className="flex items-center gap-1">
          <NavLink
            to="/calendar"
            className={({ isActive }) =>
              ['relative rounded-lg p-2 hover:bg-ink-100 dark:hover:bg-ink-800', isActive ? 'text-accent' : 'text-ink-600 dark:text-ink-300'].join(' ')
            }
            aria-label={
              next ? `Calendar - next follow-up ${badgeLabel(next.daysUntil)}` : 'Calendar'
            }
          >
            <CalendarIcon className="h-5 w-5" />
            {next && (
              <span
                aria-hidden="true"
                className={[
                  'absolute -top-1 -left-1 min-w-[1.125rem] h-[1.125rem] px-1',
                  'rounded-full text-[10px] font-semibold leading-[1.125rem] text-center text-white',
                  next.daysUntil < 0
                    ? 'bg-red-600'
                    : next.daysUntil === 0
                      ? 'bg-red-500'
                      : next.daysUntil <= 2
                        ? 'bg-amber-500'
                        : 'bg-accent',
                ].join(' ')}
              >
                {badgeText(next.daysUntil)}
              </span>
            )}
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              ['rounded-lg p-2 hover:bg-ink-100 dark:hover:bg-ink-800', isActive ? 'text-accent' : 'text-ink-600 dark:text-ink-300'].join(' ')
            }
            aria-label="Settings"
          >
            <SettingsIcon className="h-5 w-5" />
          </NavLink>
        </div>
      </div>
      {!activeCharityId && (
        <div className="bg-amber-50 text-amber-900 text-xs px-4 py-2 text-center border-t border-amber-100">
          No charity selected. An admin must invite you, or you can create one from the Admin tab.
        </div>
      )}
    </header>
  );
}

function badgeText(d: number): string {
  if (d < 0) return '!';
  if (d > 99) return '99+';
  return `${d}d`;
}

function badgeLabel(d: number): string {
  if (d < 0) return `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} overdue`;
  if (d === 0) return 'due today';
  if (d === 1) return 'in 1 day';
  return `in ${d} days`;
}

function CalendarIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18" />
    </svg>
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
