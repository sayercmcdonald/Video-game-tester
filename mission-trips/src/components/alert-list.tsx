import Link from "next/link";
import type { Alert, Severity } from "@/server/services/insights";
import { Chevron, cx } from "./ui";

const severityStyle: Record<Severity, { label: string; dot: string; text: string }> = {
  urgent: { label: "Urgent", dot: "bg-bad", text: "text-bad" },
  soon: { label: "Soon", dot: "bg-warn", text: "text-warn" },
  fyi: { label: "FYI", dot: "bg-info", text: "text-info" },
};

/** Severity is shown by a shape and a word, never color alone. */
function SeverityMark({ severity }: { severity: Severity }) {
  const s = severityStyle[severity];
  return (
    <span className={cx("inline-flex items-center gap-1 text-[12px] font-semibold tracking-wide uppercase", s.text)}>
      {severity === "urgent" ? (
        <svg aria-hidden width="10" height="10" viewBox="0 0 10 10">
          <path d="M5 0.8 9.4 9H0.6z" fill="currentColor" />
        </svg>
      ) : severity === "soon" ? (
        <span aria-hidden className={cx("size-2 rounded-full", s.dot)} />
      ) : (
        <span aria-hidden className={cx("size-2 rounded-[2px]", s.dot)} />
      )}
      {s.label}
    </span>
  );
}

export function AlertList({ alerts, showTrip = false, limit }: { alerts: (Alert & { tripName?: string })[]; showTrip?: boolean; limit?: number }) {
  const shown = limit ? alerts.slice(0, limit) : alerts;
  return (
    <ul className="divide-y divide-line">
      {shown.map((a) => (
        <li key={`${a.tripName ?? ""}:${a.id}`}>
          <Link href={a.href} className="flex min-h-11 items-start gap-3 px-4 py-3 transition-colors hover:bg-subtle active:bg-subtle sm:px-5">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <SeverityMark severity={a.severity} />
                {showTrip && a.tripName && <span className="truncate text-[13px] text-ink-3">{a.tripName}</span>}
              </span>
              <span className="mt-0.5 block font-medium">{a.title}</span>
              <span className="mt-0.5 block text-[15px] leading-snug text-ink-2 lg:text-sm">{a.detail}</span>
            </span>
            <span className="pt-6">
              <Chevron />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
