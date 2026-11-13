'use strict';

/** Local-time helpers for the founder's time zone (Intl only; no dependencies). */
function parts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' });
  return Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
}
function offsetMs(ms, tz) {
  const p = parts(ms, tz);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
const localDate = (ms, tz) => { const p = parts(ms, tz); return `${p.year}-${p.month}-${p.day}`; };
const localHour = (ms, tz) => Number(parts(ms, tz).hour);
/** UTC instant (ms) of local midnight for the local date 'YYYY-MM-DD'. */
function midnight(date, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return guess - offsetMs(guess - offsetMs(guess, tz), tz);
}
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const WEEKDAY = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** [fromIso, toIso) for a named period in the founder's time zone. */
function period(name, nowMs, tz) {
  const today = localDate(nowMs, tz);
  const iso = (date) => new Date(midnight(date, tz)).toISOString();
  const monday = addDays(today, -WEEKDAY[parts(nowMs, tz).weekday]);
  const [y, m] = today.split('-');
  const monthStart = `${y}-${m}-01`;
  const prevMonthStart = new Date(Date.UTC(+y, +m - 2, 1)).toISOString().slice(0, 10);
  const end = new Date(nowMs).toISOString();
  switch (name) {
    case 'today': return { from: iso(today), to: end, label: 'Today' };
    case 'yesterday': return { from: iso(addDays(today, -1)), to: iso(today), label: 'Yesterday' };
    case 'this_week': return { from: iso(monday), to: end, label: 'This week' };
    case 'last_week': return { from: iso(addDays(monday, -7)), to: iso(monday), label: 'Last week' };
    case 'this_month': return { from: iso(monthStart), to: end, label: 'This month' };
    case 'last_month': return { from: iso(prevMonthStart), to: iso(monthStart), label: 'Last month' };
    case 'last_30_days': return { from: new Date(nowMs - 30 * 864e5).toISOString(), to: end, label: 'Last 30 days' };
    case 'year_to_date': return { from: iso(`${y}-01-01`), to: end, label: 'Year to date' };
    default: throw new Error(`Unknown period ${name}`);
  }
}
const PERIODS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'last_30_days', 'year_to_date'];

function fmtLocal(iso, tz, { time = true, date = true } = {}) {
  if (!iso) return '—';
  const opts = { timeZone: tz };
  if (date) Object.assign(opts, { month: 'short', day: 'numeric' });
  if (time) Object.assign(opts, { hour: 'numeric', minute: '2-digit' });
  return new Intl.DateTimeFormat('en-US', opts).format(new Date(iso));
}
function ago(iso, nowMs) {
  const mins = Math.round((nowMs - Date.parse(iso)) / 60e3);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

module.exports = { localDate, localHour, midnight, addDays, period, PERIODS, fmtLocal, ago, parts };
