import { expect, test, type Page, type Browser } from "@playwright/test";
import { expectNotFound, linkFromLatestEmail, logIn, signUp, sql } from "./helpers";

// One full mission-trip lifecycle, driven through the real UI as each role.
// Steps run in order and share state.
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const ADMIN = `admin-${run}@e2e.test`;
const PLATFORM = `platform-${run}@e2e.test`;
const PARTICIPANT = `pat-${run}@e2e.test`;
const OTHER_ADMIN = `other-${run}@e2e.test`;
const ORG = `e2e-grace-${run}`;
let tripId = "";
let tripSlug = "";
let fileId = "";

const card = (page: Page, title: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

async function asUser(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept()); // confirm() prompts
  await logIn(page, email);
  return page;
}

test("a church administrator signs up and creates a church", async ({ page }) => {
  await signUp(page, "Pat Platform", PLATFORM);
  await sql(`UPDATE "User" SET "platformRole"='PLATFORM_ADMIN' WHERE email=$1`, [PLATFORM]);

  await page.context().clearCookies();
  await signUp(page, "Ruth Admin", ADMIN, "/new-church");
  await page.getByLabel("Church name").fill("E2E Grace Church");
  await page.getByLabel("Web address").fill(ORG);
  await page.getByRole("button", { name: "Create church workspace" }).click();
  await page.waitForURL(`**/o/${ORG}`);
  await expect(page.getByText("Your church is awaiting approval")).toBeVisible();
});

test("the platform administrator approves the church", async ({ browser }) => {
  const page = await asUser(browser, PLATFORM);
  await page.goto("/admin");
  const row = page.getByRole("row").filter({ hasText: "E2E Grace Church" });
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row.getByText("Active")).toBeVisible();
});

test("the admin creates and opens a trip", async ({ browser }) => {
  const page = await asUser(browser, ADMIN);
  await page.goto(`/o/${ORG}/trips/new`);
  await page.getByLabel("Trip name").fill("Honduras Build Team");
  await page.getByLabel("Destination").fill("La Ceiba, Honduras");
  await page.getByLabel("Start date").fill("2027-07-01");
  await page.getByLabel("End date").fill("2027-07-10");
  await page.getByLabel("Total budget").fill("12000");
  await page.getByLabel("Team fundraising goal").fill("8000");
  await page.getByLabel("Goal per participant").fill("1500");
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.waitForURL((u) => /\/trips\/[a-z0-9]+$/.test(u.pathname) && !u.pathname.endsWith("/new"));
  tripId = page.url().split("/").pop()!;
  await expect(page.getByText("This trip is a draft")).toBeVisible();
  await page.getByRole("button", { name: "Open trip" }).click();
  await expect(page.getByText("This trip is a draft")).toBeHidden();
  tripSlug = (await sql<{ slug: string }>(`SELECT slug FROM "Trip" WHERE id=$1`, [tripId]))[0].slug;
});

test("validation errors are shown, and bad input is rejected", async ({ browser }) => {
  const page = await asUser(browser, ADMIN);
  await page.goto(`/o/${ORG}/trips/new`);
  await page.getByLabel("Trip name").fill("Bad dates");
  await page.getByLabel("Destination").fill("Nowhere");
  await page.getByLabel("Start date").fill("2027-07-10");
  await page.getByLabel("End date").fill("2027-07-01");
  await page.getByLabel("Total budget").fill("lots");
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page.getByText("Please fix the highlighted fields.")).toBeVisible();
  await expect(page.getByText(/Total budget must be a dollar amount/)).toBeVisible();
});

test("the admin invites a participant, who signs up and accepts", async ({ browser }) => {
  const admin = await asUser(browser, ADMIN);
  await admin.goto(`/o/${ORG}/trips/${tripId}/team`);
  await admin.getByLabel("Email").fill(PARTICIPANT);
  await admin.getByRole("button", { name: "Send invitation" }).click();
  await expect(admin.getByText(`Invitation sent to ${PARTICIPANT}`)).toBeVisible();

  const invitePath = await linkFromLatestEmail(PARTICIPANT, "/invite/");
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(invitePath);
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Full name").fill("Sam Participant");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await page.waitForURL(`**/o/${ORG}`);
  await page.getByRole("link", { name: /Honduras Build Team/ }).click();
  await expect(page.getByRole("heading", { name: "My fundraising" })).toBeVisible();
  await expect(page.getByText("$1,500.00").first()).toBeVisible(); // personal goal from the trip default
});

test("leaders add requirements; the participant completes them; the admin reviews", async ({ browser }) => {
  const admin = await asUser(browser, ADMIN);
  await admin.goto(`/o/${ORG}/trips/${tripId}/requirements`);
  const add = card(admin, "Add a requirement");
  await add.getByLabel("Type").selectOption("TASK");
  await add.getByLabel("Title").fill("Attend orientation");
  await add.getByRole("button", { name: "Add requirement" }).click();
  await expect(admin.getByText("Requirement added")).toBeVisible();
  await add.getByLabel("Type").selectOption("UPLOAD");
  await add.getByLabel("Title").fill("Passport copy");
  await add.getByRole("button", { name: "Add requirement" }).click();
  await expect(card(admin, "Requirements").getByText("Passport copy")).toBeVisible();

  const p = await asUser(browser, PARTICIPANT);
  await p.goto(`/o/${ORG}/trips/${tripId}/requirements`);
  const task = card(p, "Attend orientation");
  await task.getByRole("button", { name: "Mark as done" }).click();
  await expect(task.getByText("Complete", { exact: true })).toBeVisible();

  const passport = card(p, "Passport copy");
  // A file whose contents don't match its type is rejected.
  await passport.getByLabel("Choose file").setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("not really a pdf") });
  await passport.getByRole("button", { name: "Submit" }).click();
  await expect(passport.getByText(/contents don't match its type/)).toBeVisible();
  await passport.getByLabel("Choose file").setInputFiles({ name: "passport.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%test\n%%EOF") });
  await passport.getByRole("button", { name: "Submit" }).click();
  await expect(passport.getByText("Awaiting review").first()).toBeVisible();
  fileId = (await sql<{ id: string }>(`SELECT id FROM "Document" WHERE filename='passport.pdf' ORDER BY "createdAt" DESC LIMIT 1`))[0].id;

  await admin.goto(`/o/${ORG}/trips/${tripId}/requirements`);
  const review = card(admin, "Waiting for review");
  await expect(review.getByRole("link", { name: "Open passport.pdf" })).toBeVisible();
  await review.getByRole("button", { name: "Approve" }).click();
  await expect(admin.getByRole("heading", { name: "Waiting for review" })).toBeHidden();
  await expect(card(admin, "Readiness").getByText("100%")).toBeVisible();
});

test("the admin records a check gift; the participant sees it; a receipt is issued", async ({ browser }) => {
  const admin = await asUser(browser, ADMIN);
  await admin.goto(`/o/${ORG}/trips/${tripId}/fundraising`);
  const form = card(admin, "Record a check or cash gift");
  await form.getByLabel("For").selectOption({ label: "Support Sam Participant" });
  await form.getByLabel("Donor name").fill("Grandma Jo");
  await form.getByLabel("Donor email").fill(`grandma-${run}@e2e.test`);
  await form.getByLabel("Amount").fill("150");
  await form.getByLabel("Check #").fill("2041");
  await form.getByRole("button", { name: "Record gift" }).click();
  await expect(admin.getByText("Gift recorded and receipt issued.")).toBeVisible();

  const receiptPath = await linkFromLatestEmail(`grandma-${run}@e2e.test`, "/receipts/");
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(receiptPath);
  await expect(anon.getByText("Gift receipt #1")).toBeVisible();
  await expect(anon.getByText("$150.00")).toBeVisible();
  // Without the token, the receipt is private.
  await expectNotFound(anon, receiptPath.split("?")[0]);

  const p = await asUser(browser, PARTICIPANT);
  await p.goto(`/o/${ORG}/trips/${tripId}`);
  await expect(card(p, "Recent gifts").getByText("Grandma Jo")).toBeVisible();
  await expect(card(p, "My fundraising").getByText("$150.00")).toBeVisible();
});

test("a pledge is tracked but never counted as received", async ({ browser }) => {
  const p = await asUser(browser, PARTICIPANT);
  await p.goto(`/o/${ORG}/trips/${tripId}/fundraising`);
  const pledges = card(p, "Pledges");
  await pledges.getByText("+ Add a pledge").click();
  await pledges.getByLabel("Who pledged").fill("Uncle Ray");
  await pledges.getByLabel("Amount").fill("300");
  await pledges.getByRole("button", { name: "Save pledge" }).click();
  await expect(pledges.getByText("Uncle Ray")).toBeVisible();
  await p.goto(`/o/${ORG}/trips/${tripId}`);
  await expect(card(p, "My fundraising").getByText("$150.00")).toBeVisible(); // still only the received gift
  await expect(card(p, "My fundraising").getByText("Pledged $300.00")).toBeVisible();
});

test("expenses, budget and a published donor report", async ({ browser }) => {
  const admin = await asUser(browser, ADMIN);
  await admin.goto(`/o/${ORG}/trips/${tripId}/finances`);
  const expenses = card(admin, "Expenses");
  await expenses.getByText("+ Record an expense").click();
  await expenses.getByLabel("Description").fill("Lumber");
  await expenses.getByLabel("Category").selectOption("PROJECT_MATERIALS");
  await expenses.getByLabel("Amount").fill("100");
  await expenses.getByLabel("Status").selectOption("PAID");
  await expenses.getByLabel("Date paid").fill("2027-05-01");
  await expenses.getByRole("button", { name: "Record expense" }).click();
  await expect(admin.getByText("Expense recorded.")).toBeVisible();
  await expect(card(admin, "Ledger").getByText("−$100.00")).toBeVisible();

  const reports = card(admin, "Donor reports");
  await reports.getByLabel("Title").fill("Spring update");
  await reports.getByLabel("Message to donors").fill("Lumber is purchased for the classroom roof.");
  await reports.getByRole("button", { name: "Publish report" }).click();
  await expect(admin.getByText("Report published to the public trip page.")).toBeVisible();

  const anon = await (await browser.newContext()).newPage();
  await anon.goto(`/t/${ORG}/${tripSlug}`);
  const report = card(anon, "Spring update");
  await expect(report.getByText("Lumber is purchased")).toBeVisible();
  await expect(report.getByText("$150.00")).toBeVisible(); // given
  await expect(report.getByText("$100.00").first()).toBeVisible(); // spent
  // Public pages never name donors or participants.
  await expect(anon.getByText("Grandma Jo")).toHaveCount(0);
  await expect(anon.getByText("Sam Participant")).toHaveCount(0);
});

test("online giving page explains when payments aren't available", async ({ page }) => {
  const slug = (await sql<{ slug: string }>(`SELECT c.slug FROM "Campaign" c JOIN "Trip" t ON t.id=c."tripId" WHERE t.id=$1 AND c.kind='TRIP'`, [tripId]))[0].slug;
  await page.goto(`/give/${ORG}/${slug}`);
  await expect(page.getByText("Not accepting online gifts right now")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to secure payment" })).toHaveCount(0);
});

test("people can't reach records they're not allowed to see", async ({ browser, request }) => {
  // Participant vs admin-only and finance areas
  const p = await asUser(browser, PARTICIPANT);
  await expectNotFound(p, `/o/${ORG}/people`);
  await expectNotFound(p, `/o/${ORG}/donations`);
  await expectNotFound(p, `/o/${ORG}/trips/${tripId}/finances`);
  await expectNotFound(p, `/o/${ORG}/trips/${tripId}/settings`);

  // An admin of a different church, using real IDs from this one
  const other = await (await browser.newContext()).newPage();
  await signUp(other, "Other Admin", OTHER_ADMIN, "/new-church");
  await other.getByLabel("Church name").fill("Other Church");
  await other.getByLabel("Web address").fill(`other-${run}`);
  await other.getByRole("button", { name: "Create church workspace" }).click();
  await other.waitForURL(`**/o/other-${run}`);
  await expectNotFound(other, `/o/${ORG}`);
  await expectNotFound(other, `/o/${ORG}/trips/${tripId}`);
  await expectNotFound(other, `/o/other-${run}/trips/${tripId}`); // their own church slug + our trip ID
  const crossFile = await other.request.get(`/api/files/${fileId}`);
  expect(crossFile.status()).toBe(404);

  // Private files need a signed-in, authorized user
  expect((await request.get(`/api/files/${fileId}`)).status()).toBe(401);
  const owner = await p.request.get(`/api/files/${fileId}`);
  expect(owner.status()).toBe(200);
  expect(owner.headers()["cache-control"]).toContain("no-store");

  // The cron endpoint requires its secret
  expect((await request.post("/api/cron/all")).status()).toBe(401);
  // Webhooks without a valid signature are rejected
  expect((await request.post("/api/stripe/webhook", { data: "{}" })).status()).toBe(400);
});

test("viewing a participant's private profile is recorded in the activity log", async ({ browser }) => {
  const userId = (await sql<{ id: string }>(`SELECT id FROM "User" WHERE email=$1`, [PARTICIPANT]))[0].id;
  const admin = await asUser(browser, ADMIN);
  await admin.goto(`/o/${ORG}/people/${userId}`);
  await expect(admin.getByText("Your viewing of this page is recorded")).toBeVisible();
  // An admin opening the participant's private file is also recorded.
  expect((await admin.request.get(`/api/files/${fileId}`)).status()).toBe(200);
  await admin.goto(`/o/${ORG}/audit`);
  await expect(admin.getByRole("cell", { name: "Profile viewed" }).first()).toBeVisible();
  await expect(admin.getByRole("cell", { name: "Document viewed" }).first()).toBeVisible();
});
