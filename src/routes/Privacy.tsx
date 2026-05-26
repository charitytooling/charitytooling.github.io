// TODO: Confirm jurisdiction (governing-law state) and email vendor before
// publishing publicly. This is a first-pass draft and is not legal advice.
import PublicLayout from '@/components/PublicLayout';

const CONTACT_MAILTO =
  'mailto:admin@charitytooling.com?subject=Privacy%20question';

export function PrivacyPage() {
  return (
    <PublicLayout>
      <article className="mx-auto max-w-3xl px-4 sm:px-6 py-14 sm:py-20 leading-relaxed text-ink-700 dark:text-ink-200">
        <header>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink-900 dark:text-ink-50">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-ink-500 dark:text-ink-400">
            Last updated: May 2026
          </p>
        </header>

        <Section title="Who we are">
          <p>
            CharityTooling is a donor-management tool used by verified charities to
            keep track of donations and donor communication. This policy describes
            what data we collect, why we collect it, and how we handle it. Questions?
            Email{' '}
            <a
              href={CONTACT_MAILTO}
              className="text-accent hover:text-accent-hover underline-offset-2 hover:underline"
            >
              admin@charitytooling.com
            </a>
            .
          </p>
        </Section>

        <Section title="Data we collect">
          <p>
            We collect two categories of data: account data for charity administrators
            who use the platform, and donor records that charities import or enter on
            their own behalf.
          </p>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>
              <strong>Charity admin accounts.</strong> Email address and authentication
              metadata, handled by our authentication provider (Supabase). We do not
              store passwords directly.
            </li>
            <li>
              <strong>Donor records.</strong> Names, contact details, donation amounts,
              dates, and any notes a charity adds. These records belong to the charity
              that entered them.
            </li>
            <li>
              <strong>Payment metadata.</strong> When donations are processed via
              Stripe, we store identifiers and amounts returned by Stripe. We do not
              store full card numbers or bank credentials.
            </li>
            <li>
              <strong>Operational logs.</strong> Standard server logs for security and
              debugging (timestamps, IP addresses, user-agent strings). These are
              retained for a limited period.
            </li>
          </ul>
        </Section>

        <Section title="How we use it">
          <p>
            We use this data to provide the tool to charity administrators: rendering
            ledgers, generating receipts, sending transactional email on the charity's
            behalf, and supporting their donor relationships.
          </p>
          <p className="mt-3">
            <strong>We do not sell donor data.</strong> Each charity owns its own
            ledger. We do not combine donor records across charities for marketing,
            and we do not use donor data to train models.
          </p>
        </Section>

        <Section title="Third parties we share data with">
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>
              <strong>Supabase</strong> &mdash; database, authentication, and hosting.
            </li>
            <li>
              <strong>Stripe</strong> &mdash; payment processing for donations.
            </li>
            <li>
              <strong>Email delivery provider</strong> &mdash; transactional email
              (receipts and donor communication initiated by the charity).{' '}
              {/* TODO: Replace with the specific email vendor (e.g. Postmark, Resend, SES). */}
            </li>
          </ul>
          <p className="mt-3">
            We share only what each provider needs to deliver its service, and we do
            not authorize them to use that data for their own marketing.
          </p>
        </Section>

        <Section title="Cookies and analytics">
          <p>
            We use a minimal set of cookies required for authentication and
            session state. We do not use third-party advertising trackers. If we add
            product analytics in the future, we will update this policy and disclose
            the provider here.
          </p>
        </Section>

        <Section title="Donor rights">
          <p>
            If you received an email or receipt from a charity that uses
            CharityTooling and you want to update your information or unsubscribe,
            reply directly to that email or contact the charity. We do not manage
            donor preferences on the charity's behalf, and the charity has the full
            context on your gift.
          </p>
          <p className="mt-3">
            If you believe a charity is using your data improperly and you cannot
            resolve it with them directly, write to{' '}
            <a
              href={CONTACT_MAILTO}
              className="text-accent hover:text-accent-hover underline-offset-2 hover:underline"
            >
              admin@charitytooling.com
            </a>{' '}
            and we will help.
          </p>
        </Section>

        <Section title="Data retention">
          <p>
            Charity records are retained for as long as the charity uses the platform.
            When a charity leaves, they may export their ledger; we then delete or
            archive their records on a defined schedule. Operational logs are retained
            for a limited period for security and debugging.
          </p>
        </Section>

        <Section title="Security">
          <p>
            Data is encrypted in transit (HTTPS) and at rest by our hosting and
            database providers. Access to production systems is limited to the
            CharityTooling team, and we follow standard practices for credential
            handling and audit logging. No system is perfectly secure; if we discover
            a breach affecting your data we will notify the affected charity promptly.
          </p>
        </Section>

        <Section title="Children's privacy">
          <p>
            CharityTooling is not directed to children under 13, and we do not
            knowingly collect personal information from children under 13. If you
            believe we have, contact us and we will delete it.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p>
            We may update this policy from time to time. The "Last updated" date at
            the top reflects the most recent change. Material changes will be
            communicated to charity administrators by email.
          </p>
        </Section>

        <Section title="Governing law and contact">
          <p>
            {/* TODO: Confirm governing-law state with counsel. */}
            This policy is governed by the laws of the United States and the state in
            which CharityTooling is organized. For privacy questions, write to{' '}
            <a
              href={CONTACT_MAILTO}
              className="text-accent hover:text-accent-hover underline-offset-2 hover:underline"
            >
              admin@charitytooling.com
            </a>
            .
          </p>
        </Section>
      </article>
    </PublicLayout>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-ink-900 dark:text-ink-50">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}
