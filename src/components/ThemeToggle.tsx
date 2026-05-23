import { useTheme, type Theme } from '@/theme/ThemeProvider';

const OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-xl bg-ink-100 p-1 text-sm dark:bg-ink-800"
    >
      {OPTIONS.map((opt) => {
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(opt.value)}
            className={
              'px-3 py-1.5 rounded-lg font-medium transition-colors ' +
              (active
                ? 'bg-white text-ink-900 shadow-sm dark:bg-ink-700 dark:text-ink-50'
                : 'text-ink-500 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-200')
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
