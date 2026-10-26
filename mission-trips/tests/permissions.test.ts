import { describe, expect, it } from "vitest";
import { tripPermissions, canAccessDocument, type TripMembershipFacts } from "@/server/permissions";

const base = { tripStatus: "OPEN" as const, leadersSeeFinances: true };
const leader: TripMembershipFacts = { role: "LEADER", status: "APPROVED" };
const participant: TripMembershipFacts = { role: "PARTICIPANT", status: "APPROVED" };
const applicant: TripMembershipFacts = { role: "PARTICIPANT", status: "APPLIED" };

describe("tripPermissions", () => {
  it("gives church admins full control", () => {
    const p = tripPermissions({ ...base, orgRole: "ADMIN", membership: null });
    expect(p).toMatchObject({ view: true, manage: true, viewFinances: true, administerFinances: true, viewSensitive: true });
  });

  it("lets leaders manage but not administer finances", () => {
    const p = tripPermissions({ ...base, orgRole: "MEMBER", membership: leader });
    expect(p).toMatchObject({ manage: true, viewSensitive: true, viewFinances: true, recordExpenses: true, administerFinances: false, publishPublicUpdates: false });
  });

  it("hides finances from leaders when the church turns that off", () => {
    const p = tripPermissions({ ...base, leadersSeeFinances: false, orgRole: "MEMBER", membership: leader });
    expect(p.viewFinances).toBe(false);
    expect(p.recordExpenses).toBe(false);
    expect(p.manage).toBe(true);
  });

  it("gives approved participants team access only", () => {
    const p = tripPermissions({ ...base, orgRole: "MEMBER", membership: participant });
    expect(p).toMatchObject({ view: true, viewTeam: true, isParticipant: true, manage: false, viewSensitive: false, viewFinances: false });
  });

  it("lets applicants see the trip but not team material", () => {
    const p = tripPermissions({ ...base, orgRole: "MEMBER", membership: applicant });
    expect(p.view).toBe(true);
    expect(p.viewTeam).toBe(false);
  });

  it("hides draft trips from everyone except admins and leaders", () => {
    expect(tripPermissions({ ...base, tripStatus: "DRAFT", orgRole: "MEMBER", membership: participant }).view).toBe(false);
    expect(tripPermissions({ ...base, tripStatus: "DRAFT", orgRole: "MEMBER", membership: leader }).view).toBe(true);
  });

  it("removes access for declined, withdrawn and unrelated members", () => {
    for (const status of ["DECLINED", "WITHDRAWN"] as const) {
      expect(tripPermissions({ ...base, orgRole: "MEMBER", membership: { role: "PARTICIPANT", status } }).view).toBe(false);
    }
    expect(tripPermissions({ ...base, orgRole: "MEMBER", membership: null }).view).toBe(false);
  });

  it("does not treat an unapproved leader as a leader", () => {
    const p = tripPermissions({ ...base, orgRole: "MEMBER", membership: { role: "LEADER", status: "APPLIED" } });
    expect(p.manage).toBe(false);
  });
});

describe("canAccessDocument", () => {
  const pp = tripPermissions({ ...base, orgRole: "MEMBER", membership: participant });
  const lp = tripPermissions({ ...base, orgRole: "MEMBER", membership: leader });

  it("lets a participant open their own submission but not someone else's", () => {
    expect(canAccessDocument({ kind: "SUBMISSION", isOwner: true, perms: pp, orgRole: "MEMBER" })).toBe(true);
    expect(canAccessDocument({ kind: "SUBMISSION", isOwner: false, perms: pp, orgRole: "MEMBER" })).toBe(false);
  });

  it("lets leaders review submissions", () => {
    expect(canAccessDocument({ kind: "SUBMISSION", isOwner: false, perms: lp, orgRole: "MEMBER" })).toBe(true);
  });

  it("keeps expense receipts to people who can see finances", () => {
    expect(canAccessDocument({ kind: "EXPENSE_RECEIPT", isOwner: false, perms: pp, orgRole: "MEMBER" })).toBe(false);
    expect(canAccessDocument({ kind: "EXPENSE_RECEIPT", isOwner: false, perms: lp, orgRole: "MEMBER" })).toBe(true);
  });

  it("denies access with no trip relationship", () => {
    expect(canAccessDocument({ kind: "TRIP_RESOURCE", isOwner: false, perms: null, orgRole: "MEMBER" })).toBe(false);
  });
});
