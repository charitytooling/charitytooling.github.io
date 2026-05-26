import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from './BrandMark';

const CONTACT_MAILTO =
  'mailto:admin@charitytooling.com?subject=CharityTooling%20question';

export function TopNav() {
  return (
    <header className="sticky top-0 z-10 border-b border-ink-100 dark:border-ink-800 bg-white/80 dark:bg-ink-900/80 backdrop-blur">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 h-14 flex items-center">
        <Link to="/" className="flex items-center gap-2">
          <BrandMark className="h-7 w-7 text-accent" />
          <span className="font-semibold tracking-tight">CharityTooling</span>
        </Link>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-ink-100 dark:border-ink-800">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-10 grid gap-4 sm:grid-cols-3 sm:items-center text-sm text-ink-500 dark:text-ink-400">
        <div className="flex items-center justify-center gap-2 sm:justify-start">
          <BrandMark className="h-5 w-5 text-accent" />
          <span>CharityTooling &copy; 2026</span>
        </div>
        <div className="text-center">
          Are you a charity admin?{' '}
          <Link to="/sign-in" className="text-accent hover:text-accent-hover font-medium">
            Sign in
          </Link>
        </div>
        <div className="flex justify-center gap-4 sm:justify-end">
          <Link to="/privacy" className="hover:text-accent">
            Privacy
          </Link>
          <Link to="/terms" className="hover:text-accent">
            Terms
          </Link>
          <a href={CONTACT_MAILTO} className="hover:text-accent">
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-50 dark:bg-ink-950 text-ink-900 dark:text-ink-100">
      <TopNav />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
