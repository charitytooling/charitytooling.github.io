// TODO: Confirm governing-law state and finalize paid-tier wording before
// publishing publicly. This is a first-pass draft and is not legal advice.
import PublicLayout from '@/components/PublicLayout';

const CONTACT_MAILTO =
  'mailto:admin@charitytooling.com?subject=Terms%20question';

export function TermsPage() {
  return (
    <PublicLayout>
      <article className="mx-auto max-w-3xl px-4 sm:px-6 py-14 sm:py-20 leading-relaxed text-ink-700 dark:text-ink-200">
        <header>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink-900 dark:text-ink-50">
            Terms of Service
          </h1>
          <p className="mt-3 text-sm text-ink-500 dark:text-ink-400">
            Last updated: May 2026
          </p>
        </header>

        <Section title="Agreement">
          <p>
            These Terms of Service govern access to and use of CharityTooling (the
            "Service"). By creating an account or using the Service, you agree to
            these terms on behalf of yourself and the charity you represent. If you
            do not agree, do not use the Service.
          </p>
        </Section>

        <Section title="Eligibility">
          <p>
            The Service is provided to administrators of US 501(c)(3) charities that
            meet our published 95% standard: program services expenses divided by
            total functional expenses on the most recent IRS Form 990 must be 95% or
            higher. Charities younger than 12 months from incorporation may qualify
            by presenting current books and signing an attestation that their first
            990 will land at or above 95%.
          </p>
          <p className="mt-3">
            You represent that you are authorized to act on behalf of the charity you
            register, and that the information you provide is accurate.
          </p>
        </Section>

        <Section title="Re-verification and termination">
          <p>
            When a new 990 is filed and becomes available through the IRS or
            ProPublica, we re-check the 95% ratio. Charities that fall below the
            threshold lose access to the Service. We may also suspend or terminate
            access for material breach of these terms, abuse of the platform, or
            misrepresentation during onboarding.
          </p>
          <p className="mt-3">
            On termination, charities may export their ledger for a limited period
            before records are archived or deleted in accordance with our Privacy
            Policy.
          </p>
        </Section>

        <Section title="Donor data and your responsibilities">
          <p>
            Each charity owns the donor records it enters or imports. As a charity
            administrator you agree to:
          </p>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>
              Use donor data only for legitimate charitable purposes consistent with
              the donor's reasonable expectations.
            </li>
            <li>
              Honor unsubscribe and update requests promptly.
            </li>
            <li>
              Comply with applicable laws, including CAN-SPAM, TCPA, and any state
              charitable solicitation requirements that apply to your charity.
            </li>
            <li>
              Keep your account credentials confidential and notify us promptly of any
              suspected unauthorized access.
            </li>
          </ul>
          <p className="mt-3">
            We do not sell donor data and do not combine donor records across
            charities. See our Privacy Policy for details.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p>You agree not to:</p>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Use the Service to send unsolicited marketing on behalf of unrelated organizations.</li>
            <li>Attempt to access accounts or data that do not belong to your charity.</li>
            <li>Reverse engineer, scrape, or interfere with the operation of the Service.</li>
            <li>Use the Service to violate any applicable law or to misrepresent the charitable status of any organization.</li>
          </ul>
        </Section>

        <Section title="Fees">
          <p>
            CharityTooling is offered free of charge to qualifying charities below a
            published size threshold. Charities above that threshold may be invited
            to a paid tier; pricing and terms for any paid tier will be presented in
            advance and require separate acceptance.{' '}
            {/* TODO: Replace with finalized paid-tier wording once decided. */}
          </p>
          <p className="mt-3">
            Payment processing fees charged by Stripe on donations are not part of
            CharityTooling's fees and are governed by Stripe's own terms.
          </p>
        </Section>

        <Section title="Service availability">
          <p>
            We work to keep the Service available, but we do not guarantee
            uninterrupted operation. We may perform maintenance, change features,
            or discontinue parts of the Service. Where reasonably practical we will
            give charity administrators advance notice of material changes.
          </p>
        </Section>

        <Section title="Disclaimer of warranties">
          <p>
            The Service is provided "as is" and "as available" without warranties of
            any kind, whether express or implied, including the implied warranties of
            merchantability, fitness for a particular purpose, and non-infringement.
            We do not warrant that the Service will meet your requirements or operate
            without error.
          </p>
        </Section>

        <Section title="Limitation of liability">
          <p>
            To the maximum extent permitted by law, CharityTooling and its operators
            will not be liable for any indirect, incidental, special, consequential,
            or punitive damages, or for lost profits, lost revenue, or lost data
            arising out of or related to your use of the Service. Our aggregate
            liability for any direct damages will not exceed the greater of the fees
            you paid us in the 12 months preceding the claim or one hundred US
            dollars.
          </p>
        </Section>

        <Section title="Indemnification">
          <p>
            You agree to indemnify and hold harmless CharityTooling and its operators
            from claims, damages, and expenses (including reasonable attorneys' fees)
            arising out of your charity's use of the Service, your donor
            communications, or your breach of these terms.
          </p>
        </Section>

        <Section title="Governing law">
          <p>
            {/* TODO: Confirm governing-law state and venue with counsel. */}
            These terms are governed by the laws of the United States and the state
            in which CharityTooling is organized, without regard to conflict-of-laws
            principles. Any dispute will be brought exclusively in the state or
            federal courts located in that state.
          </p>
        </Section>

        <Section title="Changes to these terms">
          <p>
            We may update these terms from time to time. The "Last updated" date at
            the top reflects the most recent change. Material changes will be
            communicated to charity administrators by email, and continued use of the
            Service after the effective date constitutes acceptance.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about these terms? Email{' '}
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
