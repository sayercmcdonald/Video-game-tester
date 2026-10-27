import Link from "next/link";

export const PRODUCT_NAME = "Sent";

/** The Sent mark: an arrow going out, for being sent to serve. */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect width="24" height="24" rx="7" fill="var(--color-accent)" />
      <path d="M8.5 15.5 15.5 8.5M10 8.5h5.5V14" fill="none" stroke="var(--color-on-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} aria-label={`${PRODUCT_NAME} home`} className="inline-flex shrink-0 items-center gap-2 text-[19px] font-bold tracking-tight whitespace-nowrap text-ink">
      <LogoMark />
      <span aria-hidden className={compact ? "hidden sm:inline" : undefined}>
        {PRODUCT_NAME}
      </span>
    </Link>
  );
}
