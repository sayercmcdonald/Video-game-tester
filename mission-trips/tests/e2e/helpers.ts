import { expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_DB } from "./global-setup";

export const PASSWORD = "correct-horse-battery";

export async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: E2E_DB });
  await c.connect();
  try {
    return (await c.query(query, params)).rows as T[];
  } finally {
    await c.end();
  }
}

export async function signUp(page: Page, name: string, email: string, next?: string) {
  await page.goto(`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/signup"));
}

export async function logIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Finds the link inside the most recent email sent to an address (emails go to the outbox table in tests). */
export async function linkFromLatestEmail(to: string, pathPrefix: string): Promise<string> {
  const rows = await sql<{ text: string }>(`SELECT text FROM "EmailOutbox" WHERE "to" = $1 ORDER BY "createdAt" DESC`, [to]);
  for (const r of rows) {
    const m = r.text.match(new RegExp(`https?://[^\\s]*${pathPrefix.replace(/\//g, "\\/")}[^\\s]*`));
    if (m) return new URL(m[0]).pathname + new URL(m[0]).search;
  }
  throw new Error(`No email to ${to} containing ${pathPrefix}`);
}

export async function expectNotFound(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
}
