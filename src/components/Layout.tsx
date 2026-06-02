import { Outlet } from 'react-router-dom';
import { BottomNav } from './BottomNav';
import { TopBar } from './TopBar';
import { InstallPrompt } from './InstallPrompt';
import { VisitTimerProvider } from '@/state/visitTimerProvider';
import { SessionTracker } from '@/state/sessionTracker';

export function Layout() {
  return (
    <VisitTimerProvider>
      <SessionTracker />
      <div className="min-h-screen flex flex-col bg-ink-50 dark:bg-ink-950">
        <TopBar />
        <main className="flex-1 overflow-y-auto pb-24 safe-top">
          <Outlet />
        </main>
        <InstallPrompt />
        <BottomNav />
      </div>
    </VisitTimerProvider>
  );
}
