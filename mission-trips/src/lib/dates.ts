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

// ── Instants in a named time zone (travel, milestones) ──

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offset of a time zone from UTC at a given instant, in minutes. */
function tzOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/**
 * Converts a wall-clock time ("2026-06-14T09:30" from a datetime-local input)
 * in a time zone to the actual instant. Returns null for malformed input.
 * In a daylight-saving gap the result moves forward to a real time.
 */
export function zonedLocalToInstant(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m || !isValidTimeZone(timeZone)) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (Number.isNaN(guess)) return null;
  let at = guess - tzOffsetMinutes(new Date(guess), timeZone) * 60000;
  // Re-check once in case the guess crossed a daylight-saving change.
  at = guess - tzOffsetMinutes(new Date(at), timeZone) * 60000;
  return new Date(at);
}

/** The datetime-local value for an instant in a time zone (to prefill forms). */
export function instantToZonedLocal(d: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)!.value;
  return `${v("year")}-${v("month")}-${v("day")}T${v("hour")}:${v("minute")}`;
}

/** "Jun 14, 9:30 AM EDT" — always with the zone, so cross-border times aren't misread. */
export function formatZoned(d: Date | null | undefined, timeZone: string, opts: { withDate?: boolean } = {}): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    ...(opts.withDate === false ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(d);
}
