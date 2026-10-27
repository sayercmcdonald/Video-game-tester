// CSV helpers. Spreadsheet apps execute cells that start with = + - @ (and a
// few control characters) as formulas, so a donor named "=HYPERLINK(...)"
// could attack whoever opens the export. Such text is prefixed with a quote.
// Values Sent formats itself (amounts, dates) are marked trusted so a
// negative amount like "-5.00" stays a number in accounting imports.

const FORMULA_START = /^[=+\-@\t\r]/;

export type Trusted = { readonly trusted: string };

export function trusted(s: string): Trusted {
  return { trusted: s };
}

export function csvCell(value: unknown): string {
  let s: string;
  if (value == null) s = "";
  else if (typeof value === "object" && value !== null && "trusted" in value) s = (value as Trusted).trusted;
  else if (value instanceof Date) s = value.toISOString().slice(0, 10);
  else if (typeof value === "number" || typeof value === "boolean") s = String(value);
  else {
    s = String(value);
    if (FORMULA_START.test(s)) s = `'${s}`;
  }
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // Excel needs a byte-order mark to read UTF-8 names correctly.
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Cents as a plain decimal ("1234.56", "-5.00") for spreadsheets and accounting imports. */
export function money(cents: number): Trusted {
  const sign = cents < 0 ? "-" : "";
  return trusted(`${sign}${(Math.abs(cents) / 100).toFixed(2)}`);
}
