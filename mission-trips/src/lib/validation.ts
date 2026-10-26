import { z } from "zod";
import { parseMoneyToCents } from "./money";
import { parseDateInput } from "./dates";

// Reusable field validators with plain-English messages.

export const zEmail = z
  .string({ error: "Email is required." })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email address." }));

export const zName = (label = "Name", max = 120) =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max, `${label} is too long.`);

export const zOptionalText = (max = 5000) => z.string().trim().max(max, "That's too long.").optional();

/** A dollar amount typed by a person, converted to cents. */
export const zMoney = (label = "Amount", { min = 0, max = 10_000_000_00 } = {}) =>
  z
    .string({ error: `${label} is required.` })
    .transform((v, ctx) => {
      const cents = parseMoneyToCents(v);
      if (cents == null) {
        ctx.addIssue({ code: "custom", message: `${label} must be a dollar amount, like 250 or 250.00.` });
        return z.NEVER;
      }
      return cents;
    })
    .pipe(
      z
        .number()
        .min(min, `${label} must be at least $${(min / 100).toFixed(2)}.`)
        .max(max, `${label} is larger than allowed.`),
    );

export const zDate = (label = "Date") =>
  z.string({ error: `${label} is required.` }).transform((v, ctx) => {
    const d = parseDateInput(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: `${label} must be a valid date.` });
      return z.NEVER;
    }
    return d;
  });

export const zOptionalDate = (label = "Date") => zDate(label).optional();

export const zCheckbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

export const zSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters.")
  .max(60, "Use 60 characters or fewer.")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.");

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}
