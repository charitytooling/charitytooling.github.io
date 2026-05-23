import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';

export function LandingPage() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/ledger" replace />;
  return <DonorLanding />;
}

const CONTACT_MAILTO =
  'mailto:admin@charitytooling.com?subject=CharityTooling%20question';

function DonorLanding() {
  return (
    <div className="min-h-screen bg-ink-50 dark:bg-ink-950 text-ink-900 dark:text-ink-100">
      <TopNav />
      <main>
        <Hero />
        <Standard />
        <WhatItDoes />
        <VerifyYourself />
        <About />
        <Questions />
      </main>
      <Footer />
    </div>
  );
}

function TopNav() {
  return (
    <header className="sticky top-0 z-10 border-b border-ink-100 dark:border-ink-800 bg-white/80 dark:bg-ink-900/80 backdrop-blur">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="h-7 w-7" />
          <span className="font-semibold tracking-tight">CharityTooling</span>
        </Link>
        <Link
          to="/sign-in"
          className="text-sm font-medium text-ink-500 dark:text-ink-400 hover:text-ink-900 dark:hover:text-ink-100"
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-3xl px-4 sm:px-6 pt-14 pb-16 sm:pt-24 sm:pb-24 text-center sm:text-left">
      <p className="text-xs uppercase tracking-wider font-semibold text-accent">
        Every charity here gives 95%+ to programs
      </p>
      <h1 className="mt-4 text-3xl sm:text-5xl font-bold tracking-tight leading-tight">
        If a charity sent you a receipt from charitytooling.com, you can trust where your
        money went.
      </h1>
      <p className="mt-6 text-lg text-ink-600 dark:text-ink-300 leading-relaxed">
        CharityTooling is the donor-management tool small charities use to keep track of
        donations like yours - calls, emails, follow-ups, and tax receipts. Before we let a
        charity onto the platform, we verify they spend at least 95% of every dollar on
        charitable programs.
      </p>
      <p className="mt-8">
        <a
          href="#standard"
          className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:text-accent-hover"
        >
          How we verify charities
          <span aria-hidden="true">&darr;</span>
        </a>
      </p>
    </section>
  );
}

const PILLARS: { title: string; body: string; icon: JSX.Element }[] = [
  {
    title: 'Public IRS Form 990 check',
    body:
      "Every active charity submitted their most recent Form 990. We compute program services expenses divided by total functional expenses and require the result to land at 95% or higher.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M9 12l2 2 4-4" />
        <path d="M9 4h6a2 2 0 0 1 2 2v0H7v0a2 2 0 0 1 2-2Z" />
        <path d="M5 6h14v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" />
      </svg>
    ),
  },
  {
    title: 'Books audit for new charities',
    body:
      "A charity younger than 12 months from incorporation hasn't filed a 990 yet. They present their current books to us and sign an attestation that their first 990 will land above 95%.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2Z" />
        <path d="M4 4v14" />
        <path d="M8 8h6M8 12h6M8 16h4" />
      </svg>
    ),
  },
  {
    title: 'Annual re-verification',
    body:
      "When the next 990 hits the IRS or ProPublica, we re-check. Charities that slipped below 95% lose access.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
        <path d="M3 21v-5h5" />
      </svg>
    ),
  },
];

function Standard() {
  return (
    <section
      id="standard"
      className="bg-white dark:bg-ink-900 border-y border-ink-100 dark:border-ink-800"
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-14 sm:py-20">
        <div className="grid gap-10 sm:grid-cols-2 sm:gap-12 sm:items-center">
          <div>
            <p
              aria-hidden="true"
              className="text-7xl sm:text-8xl font-bold tracking-tight text-accent leading-none"
            >
              95%
            </p>
            <p className="mt-3 text-base sm:text-lg font-medium text-ink-700 dark:text-ink-200">
              of every dollar to programs
            </p>
            <p className="mt-6 text-sm text-ink-500 dark:text-ink-400 leading-relaxed">
              For reference: Charity Navigator's "give with confidence" threshold is 70%,
              the IRS doesn't set one, and the average US nonprofit lands near 75%. Our
              line is 95%.
            </p>
          </div>
          <ul className="space-y-6">
            {PILLARS.map((p) => (
              <li key={p.title} className="flex gap-4">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  {p.icon}
                </div>
                <div>
                  <h3 className="font-semibold">{p.title}</h3>
                  <p className="mt-1 text-sm text-ink-600 dark:text-ink-300 leading-relaxed">
                    {p.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const DONOR_BULLETS = [
  'The spreadsheet and mailbox the charity uses for calls, emails, and follow-ups.',
  'Your tax receipt PDF was generated by us on behalf of the charity.',
  "We don't sell donor data. Each charity owns its own ledger.",
  "Unsubscribe or update preferences by replying to the email - we don't manage donor preferences on the charity's behalf.",
];

function WhatItDoes() {
  return (
    <section className="mx-auto max-w-3xl px-4 sm:px-6 py-14 sm:py-20">
      <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
        What CharityTooling is, in plain language
      </h2>
      <ul className="mt-8 space-y-4">
        {DONOR_BULLETS.map((line) => (
          <li
            key={line}
            className="flex gap-3 text-ink-700 dark:text-ink-200 leading-relaxed"
          >
            <span
              aria-hidden="true"
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
            />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const VERIFY_LINKS: { title: string; host: string; href: string; body: string }[] = [
  {
    title: 'IRS Tax Exempt Search',
    host: 'apps.irs.gov',
    href: 'https://apps.irs.gov/app/eos/',
    body: 'Official IRS lookup for any 501(c)(3) charity, including their determination letter and recent filings.',
  },
  {
    title: 'ProPublica Nonprofit Explorer',
    host: 'projects.propublica.org',
    href: 'https://projects.propublica.org/nonprofits/',
    body: 'Browse and download full IRS Form 990 PDFs back to 2001, including line-item program-spending figures.',
  },
];

function VerifyYourself() {
  return (
    <section className="bg-white dark:bg-ink-900 border-y border-ink-100 dark:border-ink-800">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Verify a charity yourself
        </h2>
        <p className="mt-3 text-ink-600 dark:text-ink-300 max-w-2xl">
          You don't have to take our word for it. Two authoritative places where a
          charity's program-spending ratio is public:
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {VERIFY_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="card hover:border-accent dark:hover:border-accent transition-colors"
            >
              <h3 className="font-semibold">{link.title}</h3>
              <p className="mt-1 text-xs text-ink-500 dark:text-ink-400">{link.host}</p>
              <p className="mt-3 text-sm text-ink-600 dark:text-ink-300 leading-relaxed">
                {link.body}
              </p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function About() {
  return (
    <section className="mx-auto max-w-3xl px-4 sm:px-6 py-14 sm:py-20">
      <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
        About CharityTooling
      </h2>
      <p className="mt-4 text-ink-600 dark:text-ink-300 leading-relaxed">
        CharityTooling was built by a small team that wanted a donor-management tool with
        actual standards behind it. Most CRM tools will take any client with a credit card.
        We won't - we verify every charity against their public IRS Form 990 (or current
        books, if they're new), and only those clearing 95%+ on charitable programs get to
        use the platform. If you have questions about our policy or a charity on our
        roster, write to{' '}
        <a
          href={CONTACT_MAILTO}
          className="text-accent hover:text-accent-hover underline-offset-2 hover:underline"
        >
          admin@charitytooling.com
        </a>
        .
      </p>
    </section>
  );
}

function Questions() {
  return (
    <section className="bg-white dark:bg-ink-900 border-y border-ink-100 dark:border-ink-800">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-14 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Have a question?
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="card">
            <h3 className="font-semibold">About your donation, receipt, or unsubscribing</h3>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-300 leading-relaxed">
              Reply directly to the email you received, or contact the charity that asked
              for your support. We don't intervene in their donor relationships, and the
              charity has the full context on your gift.
            </p>
          </div>
          <div className="card">
            <h3 className="font-semibold">
              About CharityTooling, the 95% policy, or a charity you think shouldn't be on
              our roster
            </h3>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-300 leading-relaxed">
              Write to{' '}
              <a
                href={CONTACT_MAILTO}
                className="text-accent hover:text-accent-hover underline-offset-2 hover:underline"
              >
                admin@charitytooling.com
              </a>
              . We read everything and reply within a day or two.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-ink-100 dark:border-ink-800">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-10 grid gap-4 sm:grid-cols-3 sm:items-center text-sm text-ink-500 dark:text-ink-400">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="h-5 w-5" />
          <span>CharityTooling</span>
        </div>
        <div className="text-center">
          Are you a charity admin?{' '}
          <Link to="/sign-in" className="text-accent hover:text-accent-hover font-medium">
            Sign in
          </Link>
        </div>
        <div className="flex gap-4 sm:justify-end">
          <a href={CONTACT_MAILTO} className="hover:text-accent">
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}
