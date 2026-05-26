export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      role="img"
      aria-label="CharityTooling"
      className={className}
    >
      <path
        d="M256 372s-120-72-120-168a76 76 0 0 1 120-62 76 76 0 0 1 120 62c0 96-120 168-120 168z"
        fill="none"
        stroke="currentColor"
        strokeWidth={32}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="256" cy="240" r="28" fill="currentColor" />
    </svg>
  );
}
