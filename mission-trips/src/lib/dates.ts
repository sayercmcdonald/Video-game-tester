// Date-only values (trip dates, deadlines) are stored as UTC midnight and
// must be displayed in UTC so they never shift by a day.

export function formatDate(d: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC", ...opts }).format(date);
}

export function formatDateRange(start: Date, end: Date): string {
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const a = formatDate(start, sameYear ? { year: undefined } : {});
  return `${a} – ${formatDate(end)}`;
}

/** Timestamps (donations, posts) shown in the church's timezone. */
export function formatDateTime(d: Date | null | undefined, timeZone = "America/Chicago"): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(d);
}

/** Parses "YYYY-MM-DD" from a date input into UTC midnight. */
export function parseDateInput(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toDateInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/** Whole days from today (UTC) until a date-only value. Negative means overdue. */
export function daysUntil(d: Date, now = new Date()): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((d.getTime() - today) / 86_400_000);
}
