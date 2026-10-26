import Link from "next/link";

export function Logo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} aria-label="Mission Trips home" className="inline-flex shrink-0 items-center gap-2 font-semibold tracking-tight whitespace-nowrap text-ink">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <rect width="24" height="24" rx="6" fill="var(--color-accent)" />
        <path d="M6 16.5 10 8l3 5.5 1.8-3 3.2 6" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span aria-hidden className={compact ? "hidden sm:inline" : undefined}>Mission Trips</span>
    </Link>
  );
}
