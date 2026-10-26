// The permission rules for the whole platform, as pure functions.
// Every server action and page calls these after loading data scoped to the
// current church, so a user can never act on another church's records.

export type OrgRoleT = "ADMIN" | "MEMBER";
export type TripRoleT = "LEADER" | "PARTICIPANT";
export type TripMemberStatusT = "APPLIED" | "APPROVED" | "WAITLISTED" | "DECLINED" | "WITHDRAWN";
export type TripStatusT = "DRAFT" | "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export type TripMembershipFacts = { role: TripRoleT; status: TripMemberStatusT } | null;

export type TripPermissions = {
  /** See the trip exists and its basic details. */
  view: boolean;
  /** See team-only material: roster, itinerary, team announcements, shared documents. */
  viewTeam: boolean;
  /** Edit the trip, approve participants, manage requirements, post announcements, review submissions. */
  manage: boolean;
  /** See emergency contacts and medical details of other participants. */
  viewSensitive: boolean;
  /** See trip-wide donations, fees, expenses and budget. */
  viewFinances: boolean;
  /** Record and edit expenses. */
  recordExpenses: boolean;
  /** Admin-only financial controls: refunds, offline gifts, adjustments, publishing reports. */
  administerFinances: boolean;
  /** Publish donor-facing updates without a separate approval. */
  publishPublicUpdates: boolean;
  /** An approved participant (has a personal dashboard and fundraising page). */
  isParticipant: boolean;
  isLeader: boolean;
  isOrgAdmin: boolean;
};

export function tripPermissions(input: {
  orgRole: OrgRoleT;
  tripStatus: TripStatusT;
  leadersSeeFinances: boolean;
  membership: TripMembershipFacts;
}): TripPermissions {
  const { orgRole, tripStatus, leadersSeeFinances, membership } = input;
  const isOrgAdmin = orgRole === "ADMIN";
  const approved = membership?.status === "APPROVED";
  const isLeader = approved && membership?.role === "LEADER";
  const isParticipant = approved && membership?.role === "PARTICIPANT";

  // Applicants and waitlisted people may see the trip (and their own status),
  // but not team material. Declined/withdrawn people lose access.
  const activeRelationship =
    membership != null && membership.status !== "DECLINED" && membership.status !== "WITHDRAWN";
  const view = isOrgAdmin || isLeader || (activeRelationship && tripStatus !== "DRAFT");

  const manage = isOrgAdmin || isLeader;
  const viewFinances = isOrgAdmin || (isLeader && leadersSeeFinances);

  return {
    view,
    viewTeam: manage || isParticipant,
    manage,
    viewSensitive: manage,
    viewFinances,
    recordExpenses: viewFinances,
    administerFinances: isOrgAdmin,
    publishPublicUpdates: isOrgAdmin,
    isParticipant,
    isLeader,
    isOrgAdmin,
  };
}

export function canManageOrg(orgRole: OrgRoleT | null): boolean {
  return orgRole === "ADMIN";
}

/** Who may download a stored document. */
export function canAccessDocument(input: {
  kind: "SUBMISSION" | "TRIP_RESOURCE" | "EXPENSE_RECEIPT" | "REQUIREMENT_TEMPLATE";
  isOwner: boolean;
  perms: TripPermissions | null;
  orgRole: OrgRoleT;
}): boolean {
  const { kind, isOwner, perms, orgRole } = input;
  if (orgRole === "ADMIN") return true;
  if (!perms) return false;
  switch (kind) {
    case "SUBMISSION":
      return isOwner || perms.viewSensitive;
    case "EXPENSE_RECEIPT":
      return perms.viewFinances;
    case "TRIP_RESOURCE":
    case "REQUIREMENT_TEMPLATE":
      return perms.viewTeam;
  }
}
