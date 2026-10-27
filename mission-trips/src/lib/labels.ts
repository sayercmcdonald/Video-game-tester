// Human-friendly names for database values, used across the UI.

type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";

export const tripStatusLabel = {
  DRAFT: "Draft",
  OPEN: "Open",
  IN_PROGRESS: "Underway",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
} as const;

export const tripStatusTone: Record<keyof typeof tripStatusLabel, Tone> = {
  DRAFT: "neutral",
  OPEN: "accent",
  IN_PROGRESS: "info",
  COMPLETED: "good",
  CANCELLED: "bad",
};

export const memberStatusLabel = {
  APPLIED: "Applied",
  APPROVED: "Approved",
  WAITLISTED: "Waitlisted",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
} as const;

export const memberStatusTone: Record<keyof typeof memberStatusLabel, Tone> = {
  APPLIED: "warn",
  APPROVED: "good",
  WAITLISTED: "info",
  DECLINED: "bad",
  WITHDRAWN: "neutral",
};

export const donationStatusLabel = {
  PENDING: "Pending",
  SUCCEEDED: "Received",
  FAILED: "Failed",
  CANCELED: "Abandoned",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partly refunded",
  DISPUTED: "Disputed",
} as const;

export const donationStatusTone: Record<keyof typeof donationStatusLabel, Tone> = {
  PENDING: "warn",
  SUCCEEDED: "good",
  FAILED: "bad",
  CANCELED: "neutral",
  REFUNDED: "neutral",
  PARTIALLY_REFUNDED: "info",
  DISPUTED: "bad",
};

export const donationMethodLabel = {
  CARD_ONLINE: "Online",
  CHECK: "Check",
  CASH: "Cash",
  OTHER_OFFLINE: "Other",
} as const;

export const expenseCategoryLabel = {
  TRAVEL: "Airfare & travel",
  LODGING: "Lodging",
  FOOD: "Food",
  GROUND_TRANSPORT: "Ground transport",
  MINISTRY_SUPPLIES: "Ministry supplies",
  PROJECT_MATERIALS: "Project materials",
  INSURANCE: "Insurance",
  FEES: "Fees & visas",
  OTHER: "Other",
} as const;

export const expenseStatusLabel = { PENDING_APPROVAL: "Awaiting approval", COMMITTED: "Committed", PAID: "Paid", REJECTED: "Declined", VOID: "Void" } as const;

export const requirementKindLabel = {
  UPLOAD: "File upload",
  WAIVER: "Signed waiver",
  FORM: "Form",
  TASK: "Task",
} as const;

export const submissionStatusLabel = {
  NOT_STARTED: "Not started",
  SUBMITTED: "Awaiting review",
  APPROVED: "Complete",
  CHANGES_REQUESTED: "Needs changes",
} as const;

export const submissionStatusTone: Record<keyof typeof submissionStatusLabel, Tone> = {
  NOT_STARTED: "neutral",
  SUBMITTED: "warn",
  APPROVED: "good",
  CHANGES_REQUESTED: "bad",
};

export const itineraryKindLabel = {
  TRAVEL: "Travel",
  LODGING: "Lodging",
  ACTIVITY: "Activity",
  MEETING: "Meeting",
  OTHER: "Other",
} as const;

export const restrictionLabel = {
  RESTRICTED: "Designated for this trip",
  UNRESTRICTED: "Unrestricted",
} as const;
