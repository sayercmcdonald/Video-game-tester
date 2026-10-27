import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { tripContextFor } from "@/server/context";
import { csvCell, money, toCsv } from "@/server/integrations/csv";
import { runExport } from "@/server/integrations/exports";
import { findLinkedEntity, linkExternal, loadCredentials, saveCredentials } from "@/server/integrations/links";
import { PROVIDERS } from "@/server/integrations/registry";
import { recordOfflineDonation, requestRefund } from "@/server/services/donations";
import { createExpense } from "@/server/services/finance";
import { addMember, ctxFor, makeOrg, makeTrip, resetDb } from "./helpers/factory";
import { FakeGateway } from "./helpers/fake-gateway";

beforeEach(resetDb);

describe("CSV safety", () => {
  it("neutralizes spreadsheet formulas in text but keeps our own amounts numeric", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(money(-500))).toBe("-5.00");
    expect(csvCell(money(123456))).toBe("1234.56");
    expect(csvCell("Smith, Jo")).toBe('"Smith, Jo"');
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a"], [["b"]])).toBe("﻿a\r\nb\r\n");
  });
});

describe("exports", () => {
  async function setup() {
    const o = await makeOrg();
    const { trip, fund } = await makeTrip(o.org.id);
    const t = await tripContextFor(o.ctx, trip.id);
    return { ...o, trip, fund, t };
  }

  it("exports gifts, expenses and the ledger with correct figures, and logs each export", async () => {
    const s = await setup();
    const gift = await recordOfflineDonation(s.t, { campaignId: s.fund.id, amount: "300", donorName: "=cmd|' /C calc'!A0", donorEmail: "d@example.test", method: "CHECK", reference: "77", receivedOn: "2027-01-05" });
    await requestRefund(new FakeGateway(), s.t, gift.id, { amount: "50" });
    await createExpense(s.t, { category: "TRAVEL", description: "Bus", vendor: "Coach Co", amount: "120", status: "PAID", incurredOn: "2027-01-06", paidOn: "2027-01-06" });

    const d = await runExport(s.ctx, "donations");
    expect(d.rows).toBe(1);
    expect(d.csv).toContain("'=cmd"); // neutralized
    expect(d.csv).toContain(",300.00,50.00,250.00,0.00,Check,77,Partly refunded,");

    const e = await runExport(s.ctx, "expenses");
    expect(e.csv).toContain("Airfare & travel,Bus,Coach Co,120.00,Paid");

    const l = await runExport(s.ctx, "ledger", s.trip.id);
    expect(l.rows).toBe(3);
    expect(l.csv).toContain("Gift received,300.00");
    expect(l.csv).toContain("Refund,-50.00");
    expect(l.csv).toContain("Expense paid,-120.00");

    expect(await db.syncRun.count({ where: { orgId: s.org.id, status: "SUCCEEDED" } })).toBe(3);
    expect(await db.auditLog.count({ where: { action: "export.downloaded" } })).toBe(3);
  });

  it("is limited to church administrators and to the church's own trips", async () => {
    const s = await setup();
    const member = await addMember(s.org.id);
    await expect(runExport(await ctxFor(member, s.org.slug), "donations")).rejects.toBeInstanceOf(AppError);
    const other = await makeOrg();
    await recordOfflineDonation(s.t, { campaignId: s.fund.id, amount: "10", donorName: "Private Person", method: "CASH", receivedOn: "2027-01-05" });
    // Another church's admin can't export this trip, and their own export doesn't contain it.
    await expect(runExport(other.ctx, "donations", s.trip.id)).rejects.toThrow(/not found/);
    expect((await runExport(other.ctx, "donations")).csv).not.toContain("Private Person");
  });
});

describe("integration plumbing", () => {
  it("links external records without duplicates and refuses conflicting links", async () => {
    const { org } = await makeOrg();
    const base = { orgId: org.id, provider: "PLANNING_CENTER" as const, entityType: "Donation", externalId: "pco_123", owner: "SENT" as const };
    const a = await linkExternal({ ...base, entityId: "don_1" });
    const b = await linkExternal({ ...base, entityId: "don_1" });
    expect(b.id).toBe(a.id);
    expect(await db.externalLink.count()).toBe(1);
    await expect(linkExternal({ ...base, entityId: "don_2" })).rejects.toThrow(/already linked/);
    expect(await findLinkedEntity(org.id, "PLANNING_CENTER", "Donation", "pco_123")).toBe("don_1");
    // Same external ID in another church is a separate record.
    const other = await makeOrg();
    await linkExternal({ ...base, orgId: other.org.id, entityId: "don_9" });
    expect(await findLinkedEntity(org.id, "PLANNING_CENTER", "Donation", "pco_123")).toBe("don_1");
  });

  it("stores credentials encrypted", async () => {
    const { org, admin } = await makeOrg();
    await saveCredentials(org.id, "PLANNING_CENTER", admin.id, { appId: "abc", secret: "s3cret-value" });
    const row = await db.integration.findFirstOrThrow();
    expect(row.credentialsEncrypted).not.toContain("s3cret-value");
    expect(await loadCredentials(org.id, "PLANNING_CENTER")).toEqual({ appId: "abc", secret: "s3cret-value" });
  });

  it("only advertises integrations that actually work", () => {
    expect(PROVIDERS.filter((p) => p.availability === "available").map((p) => p.provider)).toEqual(["CSV_EXPORT"]);
  });
});
