import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

// Shared presentational components. Server-safe (no client hooks).
// Visual language follows Apple's HIG: see docs/DESIGN.md.

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
// Capsule buttons. 44px tall on phones (Apple's minimum touch target), 36px with a mouse on wide screens.
const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-full px-5 h-11 lg:h-9 lg:px-4 text-[17px] lg:text-[15px] font-semibold transition-[background-color,opacity,transform] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 whitespace-nowrap select-none";
const buttonVariants: Record<Variant, string> = {
  // Filled: the one most likely action in a view.
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  // Tinted: secondary actions.
  secondary: "bg-accent-soft text-accent-ink hover:brightness-95 dark:hover:brightness-110",
  // Plain: low-emphasis actions inside lists and cards.
  ghost: "px-3 lg:px-3 font-medium text-accent hover:bg-fill",
  // Destructive: never styled as the primary action.
  danger: "bg-bad-soft text-bad hover:brightness-95 dark:hover:brightness-110",
};

export function buttonClass(variant: Variant = "primary", extra?: string) {
  return cx(buttonBase, buttonVariants[variant], extra);
}

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={buttonClass(variant, className)} {...props} />;
}

/** A grouped section: white on the gray canvas, rounded, no border in light mode. */
export function Card({ className, children, ...props }: ComponentProps<"section">) {
  return (
    <section className={cx("min-w-0 overflow-hidden rounded-[var(--radius-card)] bg-surface dark:ring-1 dark:ring-line", className)} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 pt-4 pb-2 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-[20px] leading-tight font-semibold tracking-tight lg:text-[17px]">{title}</h2>
        {description && <p className="mt-1 text-[15px] leading-snug text-ink-3 lg:text-[13px]">{description}</p>}
      </div>
      {action && <div className="-mt-1 -mr-2 shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("px-4 py-4 sm:px-5", className)}>{children}</div>;
}

/** Apple's "large title" page header. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[15px] text-ink-3">{eyebrow}</div>}
        <h1 className="text-[34px] leading-[1.15] font-bold tracking-tight lg:text-[28px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";
const toneClass: Record<Tone, string> = {
  neutral: "bg-fill text-ink-2",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent-ink",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] leading-5 font-medium whitespace-nowrap lg:text-xs", toneClass[tone], className)}>
      {children}
    </span>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: Exclude<Tone, "accent">; title?: ReactNode; children?: ReactNode }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cx("rounded-2xl px-4 py-3 text-[15px] leading-snug lg:text-sm", toneClass[tone])}>
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className={cx(title ? "mt-0.5" : "")}>{children}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="text-[17px] font-semibold">{title}</div>
      {children && <p className="mt-1 max-w-md text-[15px] text-ink-3 lg:text-sm">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A horizontal progress meter with an accessible label. */
export function Progress({ value, max, label, tone = "accent", size = "md" }: { value: number; max: number; label: string; tone?: "accent" | "good" | "warn" | "bad"; size?: "sm" | "md" }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const fill = { accent: "bg-accent", good: "bg-good", warn: "bg-warn", bad: "bg-bad" }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      className={cx("w-full overflow-hidden rounded-full bg-fill", size === "sm" ? "h-1.5" : "h-2")}
    >
      <div className={cx("h-full rounded-full", fill)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" | "warn" }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] font-medium text-ink-3 lg:text-xs">{label}</div>
      <div className={cx("mt-0.5 text-[22px] leading-tight font-bold tracking-tight tabular-nums lg:text-xl", tone === "bad" && "text-bad", tone === "good" && "text-good", tone === "warn" && "text-warn")}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[13px] text-ink-3">{sub}</div>}
    </div>
  );
}

/** On phones, tables render as grouped list rows (see .list-table in globals.css). Give each Td a `label`. */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cx("list-table w-full min-w-[36rem] text-left text-[15px] lg:text-sm [&_tbody_tr:last-child_td]:border-b-0", className)}>{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cx("border-b border-line px-5 py-2 text-xs font-medium whitespace-nowrap text-ink-3", className)}>{children}</th>;
}

export function Td({ children, className, label }: { children?: ReactNode; className?: string; label?: string }) {
  return (
    <td data-label={label} className={cx("border-b border-line px-5 py-3 align-middle", className)}>
      {label ? <span className="td-value">{children}</span> : children}
    </td>
  );
}

/** Label/value rows, like a Settings detail screen. */
export function DescriptionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="-my-1 divide-y divide-line">
      {items.map((i) => (
        <div key={i.label} className="flex items-baseline justify-between gap-6 py-2.5">
          <dt className="shrink-0 text-ink-3">{i.label}</dt>
          <dd className="min-w-0 text-right">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A tappable list row with a disclosure chevron, for drilling into a detail screen. */
export function ListRow({ href, title, subtitle, trailing }: { href: string; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode }) {
  return (
    <Link href={href} className="flex min-h-11 items-center gap-3 px-4 py-3 transition-colors hover:bg-subtle active:bg-subtle sm:px-5">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {subtitle && <span className="block truncate text-[15px] text-ink-3 lg:text-sm">{subtitle}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-1.5">{trailing}</span>}
      <Chevron />
    </Link>
  );
}

export function Chevron() {
  return (
    <svg aria-hidden width="8" height="14" viewBox="0 0 8 14" className="shrink-0 text-ink-3 opacity-60">
      <path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter((p) => /^[\p{L}]/u.test(p))
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-ink"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials || "?"}
    </span>
  );
}
