import { RESEARCH_PROVIDERS, type ResearchSubject } from '@/lib/researchLinks';

// Shared research chip strip. ONE provider list (RESEARCH_PROVIDERS) and ONE
// rendering, used by both the Update page and the Search org-detail modal — so
// editing the list updates everywhere. Render inside a flex-wrap container.
export function ResearchChips({ subject }: { subject: ResearchSubject }) {
  return (
    <>
      {RESEARCH_PROVIDERS.map((p) => (
        <ResearchLink key={p.label} label={p.label} href={p.build(subject)} />
      ))}
    </>
  );
}

function ResearchLink({ label, href }: { label: string; href: string | null }) {
  if (!href) return null;
  // Google sits among ~13 other pills and is the link reps reach for most
  // often, so it gets a distinct green treatment that contrasts with both the
  // default gray pills and the blue accent used elsewhere in the app.
  const isHighlighted = label === 'Google';
  const palette = isHighlighted
    ? 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300'
    : 'bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200';
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`px-3 py-1.5 rounded-full font-medium ${palette}`}
    >
      {label}
    </a>
  );
}
