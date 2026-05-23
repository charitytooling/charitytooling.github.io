import { useEffect, useState } from 'react';
import { isIOS, isStandalone } from '@/lib/push';

const DISMISS_KEY = 'ct.installPromptDismissedAt';

export function InstallPrompt() {
  const [dismissed, setDismissed] = useState(false);
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const last = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    if (last && Date.now() - last < 7 * 24 * 3600_000) {
      setDismissed(true);
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (dismissed || isStandalone()) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  }

  if (isIOS()) {
    return (
      <div className="fixed inset-x-0 bottom-24 z-30 px-3">
        <div className="mx-auto max-w-3xl card bg-ink-900 text-white border-0 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-semibold">Install CharityTooling</p>
              <p className="text-sm text-ink-200">
                Tap <ShareIcon /> in Safari, then <span className="font-semibold">Add to Home Screen</span> for
                the best experience, offline support, and notifications.
              </p>
            </div>
            <button type="button" onClick={dismiss} className="text-ink-300 text-xs">
              Later
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (deferredEvent) {
    return (
      <div className="fixed inset-x-0 bottom-24 z-30 px-3">
        <div className="mx-auto max-w-3xl card flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold">Install CharityTooling</p>
            <p className="text-sm text-ink-500">Faster launch and offline access.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="text-sm text-ink-500" onClick={dismiss}>
              Later
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                await deferredEvent.prompt();
                dismiss();
              }}
            >
              Install
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="inline-block h-4 w-4 -mt-0.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}
