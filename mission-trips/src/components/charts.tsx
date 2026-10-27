import type { ReactNode } from "react";
import { formatMoney } from "@/lib/money";
import { cx } from "./ui";

// Small, dependency-free charts. Each mark has a hover tooltip, each chart
// with two series has a legend, and every chart offers a table view.

function Tip({ children }: { children: ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 rounded-lg bg-ink px-2.5 py-1 text-xs whitespace-nowrap text-canvas shadow-lg group-hover:block group-focus-visible:block"
    >
      {children}
    </span>
  );
}

export function Legend({ items }: { items: { label: string; swatch: "s1" | "s2" | "budget" }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.swatch === "budget" ? (
            <span aria-hidden className="h-3 w-0.5 bg-ink" />
          ) : (
            <span aria-hidden className={cx("size-2.5 rounded-sm", i.swatch === "s1" ? "bg-[var(--color-series-1)]" : "bg-[var(--color-series-2)]")} />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export type BulletRow = { label: string; primary: number; secondary?: number; target: number };

/**
 * Horizontal bullet bars: a solid bar (e.g. paid), an optional second segment
 * (e.g. committed) after a 2px gap, and a tick for the target (e.g. budget).
 */
export function BulletChart({
  rows,
  primaryLabel,
  secondaryLabel,
  targetLabel,
  currency = "usd",
  caption,
}: {
  rows: BulletRow[];
  primaryLabel: string;
  secondaryLabel?: string;
  targetLabel: string;
  currency?: string;
  caption: string;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.primary + (r.secondary ?? 0), r.target)));
  const pct = (v: number) => `${(v / max) * 100}%`;
  return (
    <figure>
      <figcaption className="sr-only">{caption}</figcaption>
      <div className="mb-3">
        <Legend
          items={[
            { label: primaryLabel, swatch: "s1" },
            ...(secondaryLabel ? [{ label: secondaryLabel, swatch: "s2" as const }] : []),
            { label: targetLabel, swatch: "budget" },
          ]}
        />
      </div>
      <ul className="space-y-3">
        {rows.map((r) => {
          const over = r.target > 0 && r.primary + (r.secondary ?? 0) > r.target;
          return (
            <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate text-ink-2">{r.label}</span>
              <div className="relative h-3">
                <div className="absolute inset-y-0 left-0 flex w-full gap-0.5">
                  {r.primary > 0 && (
                    <span tabIndex={0} className="group relative h-full rounded-r-[4px] bg-[var(--color-series-1)] outline-none" style={{ width: pct(r.primary) }}>
                      <Tip>
                        {r.label} · {primaryLabel}: {formatMoney(r.primary, currency)}
                      </Tip>
                    </span>
                  )}
                  {(r.secondary ?? 0) > 0 && (
                    <span tabIndex={0} className="group relative h-full rounded-r-[4px] bg-[var(--color-series-2)] outline-none" style={{ width: pct(r.secondary!) }}>
                      <Tip>
                        {r.label} · {secondaryLabel}: {formatMoney(r.secondary!, currency)}
                      </Tip>
                    </span>
                  )}
                </div>
                {r.target > 0 && (
                  <span aria-hidden className="absolute -inset-y-1 w-0.5 bg-ink" style={{ left: `calc(${pct(r.target)} - 1px)` }} title={`${targetLabel}: ${formatMoney(r.target, currency)}`} />
                )}
              </div>
              <span className={cx("text-right tabular-nums", over ? "font-medium text-bad" : "text-ink-2")}>
                {formatMoney(r.primary + (r.secondary ?? 0), currency, { compact: true })}
                <span className="text-ink-3"> / {r.target > 0 ? formatMoney(r.target, currency, { compact: true }) : "—"}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-ink-3 hover:text-ink">Show as table</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr className="text-xs text-ink-3 uppercase">
              <th className="py-1 font-medium">Category</th>
              <th className="py-1 text-right font-medium">{primaryLabel}</th>
              {secondaryLabel && <th className="py-1 text-right font-medium">{secondaryLabel}</th>}
              <th className="py-1 text-right font-medium">{targetLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-line">
                <td className="py-1.5">{r.label}</td>
                <td className="py-1.5 text-right tabular-nums">{formatMoney(r.primary, currency)}</td>
                {secondaryLabel && <td className="py-1.5 text-right tabular-nums">{formatMoney(r.secondary ?? 0, currency)}</td>}
                <td className="py-1.5 text-right tabular-nums">{formatMoney(r.target, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Raised (solid) and pledged (second segment) toward a goal, in one bar. */
export function GoalMeter({ raised, pledged = 0, goal, currency = "usd", label }: { raised: number; pledged?: number; goal: number; currency?: string; label: string }) {
  const max = Math.max(goal, raised + pledged, 1);
  const w = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.min(raised, goal)}
        aria-valuetext={`${formatMoney(raised, currency)} received of ${formatMoney(goal, currency)}${pledged ? `, plus ${formatMoney(pledged, currency)} pledged` : ""}`}
        className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-fill"
      >
        {raised > 0 && <span className="h-full rounded-r-[4px] bg-[var(--color-series-1)]" style={{ width: w(raised) }} />}
        {pledged > 0 && <span className="h-full rounded-r-[4px] bg-[var(--color-series-2)]" style={{ width: w(pledged) }} />}
      </div>
    </div>
  );
}
