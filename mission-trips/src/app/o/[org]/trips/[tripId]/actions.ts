"use server";

import { revalidatePath } from "next/cache";
import { run, formObject, type ActionState } from "@/server/actions";
import { requireTrip } from "@/server/context";
import { stripeGateway } from "@/server/payments/gateway";
import { updateCampaign, createProjectCampaign } from "@/server/services/campaigns";
import { recordOfflineDonation, requestRefund } from "@/server/services/donations";
import { createPledge, setPledgeStatus, createExpense, markExpensePaid, voidExpense, attachExpenseReceipt, setBudgetLines, publishFinancialReport } from "@/server/services/finance";
import { createRequirement, deleteRequirement, reviewSubmission, setRequirementRequired, submitRequirement } from "@/server/services/requirements";
import { createPost, approvePost, deletePost } from "@/server/services/posts";
import { uploadTripResource, deleteTripResource } from "@/server/services/documents";

const path = (org: string, tripId: string, sub = "") => `/o/${org}/trips/${tripId}${sub}`;

// ── Fundraising ──

export async function updateCampaignAction(org: string, tripId: string, campaignId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    await updateCampaign(await requireTrip(org, tripId), campaignId, formObject(fd) as never);
    revalidatePath(path(org, tripId), "layout");
    return { ok: true, message: "Saved." };
  });
}

export async function createProjectCampaignAction(org: string, tripId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    await createProjectCampaign(await requireTrip(org, tripId), formObject(fd) as never);
    revalidatePath(path(org, tripId, "/fundraising"));
    return { ok: true, message: "Project campaign created." };
  });
}

export async function recordOfflineDonationAction(org: string, tripId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    await recordOfflineDonation(await requireTrip(org, tripId), formObject(fd) as never);
    revalidatePath(path(org, tripId), "layout");
    return { ok: true, message: "Gift recorded and receipt issued." };
  });
}

export async function refundAction(org: string, tripId: string, donationId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    const r = await requestRefund(stripeGateway, await requireTrip(org, tripId), donationId, formObject(fd) as never);
    revalidatePath(path(org, tripId), "layout");
    return {
      ok: true,
      message: r.pending ? "Refund requested. It will show as refunded once Stripe confirms (usually within a minute)." : "Refund recorded.",
    };
  });
}

export async function createPledgeAction(org: string, tripId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    await createPledge(await requireTrip(org, tripId), formObject(fd) as never);
    revalidatePath(path(org, tripId), "layout");
    return { ok: true, message: "Pledge saved. It isn't counted as received until the gift arrives." };
  });
}

export async function setPledgeStatusAction(org: string, tripId: string, pledgeId: string, status: "FULFILLED" | "CANCELLED", _prev: ActionState) {
  return run(async () => {
    await setPledgeStatus(await requireTrip(org, tripId), pledgeId, status);
    revalidatePath(path(org, tripId), "layout");
  });
}

// ── Requirements ──

export async function createRequirementAction(org: string, tripId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    await createRequirement(await requireTrip(org, tripId), formObject(fd) as never, fd.get("template") as File | null);
    revalidatePath(path(org, tripId), "layout");
    return { ok: true, message: "Requirement added. Participants were notified." };
  });
}

export async function deleteRequirementAction(org: string, tripId: string, requirementId: string, _prev: ActionState) {
  return run(async () => {
    await deleteRequirement(await requireTrip(org, tripId), requirementId);
    revalidatePath(path(org, tripId), "layout");
  });
}

export async function setRequirementRequiredAction(org: string, tripId: string, requirementId: string, required: boolean, _prev: ActionState) {
  return run(async () => {
    await setRequirementRequired(await requireTrip(org, tripId), requirementId, required);
    revalidatePath(path(org, tripId), "layout");
  });
}

export async function submitRequirementAction(org: string, tripId: string, requirementId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    const s = await submitRequirement(await requireTrip(org, tripId), requirementId, fd);
    revalidatePath(path(org, tripId), "layout");
    return { ok: true, message: s.status === "APPROVED" ? "Done — marked complete." : "Submitted. A leader will review it." };
  });
}

export async function reviewSubmissionAction(org: string, tripId: string, submissionId: string, decision: "APPROVED" | "CHANGES_REQUESTED", _prev: ActionState, fd: FormData) {
  return run(async () => {
    await reviewSubmission(await requireTrip(org, tripId), submissionId, decision, String(fd.get("note") ?? ""));
    revalidatePath(path(org, tripId), "layout");
    return { ok: true, message: decision === "APPROVED" ? "Approved." : "Sent back with your note." };
  });
}

// ── Updates ──

export async function createPostAction(org: string, tripId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    const p = await createPost(await requireTrip(org, tripId), formObject(fd) as never);
    revalidatePath(path(org, tripId), "layout");
    return { ok: true, message: p.status === "PUBLISHED" ? "Posted." : "Sent to a church administrator for approval before donors see it." };
  });
}

export async function approvePostAction(org: string, tripId: string, postId: string, _prev: ActionState) {
  return run(async () => {
    await approvePost(await requireTrip(org, tripId), postId);
    revalidatePath(path(org, tripId), "layout");
  });
}

export async function deletePostAction(org: string, tripId: string, postId: string, _prev: ActionState) {
  return run(async () => {
    await deletePost(await requireTrip(org, tripId), postId);
    revalidatePath(path(org, tripId), "layout");
  });
}

// ── Documents ──

export async function uploadResourceAction(org: string, tripId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    await uploadTripResource(await requireTrip(org, tripId), fd.get("file") as File | null);
    revalidatePath(path(org, tripId, "/documents"));
    return { ok: true, message: "Uploaded." };
  });
}

export async function deleteResourceAction(org: string, tripId: string, documentId: string, _prev: ActionState) {
  return run(async () => {
    await deleteTripResource(await requireTrip(org, tripId), documentId);
    revalidatePath(path(org, tripId, "/documents"));
  });
}

// ── Finances ──

export async function createExpenseAction(org: string, tripId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    await createExpense(await requireTrip(org, tripId), formObject(fd) as never, fd.get("receipt") as File | null);
    revalidatePath(path(org, tripId), "layout");
    return { ok: true, message: "Expense recorded." };
  });
}

export async function markExpensePaidAction(org: string, tripId: string, expenseId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    await markExpensePaid(await requireTrip(org, tripId), expenseId, String(fd.get("paidOn") ?? ""));
    revalidatePath(path(org, tripId), "layout");
  });
}

export async function voidExpenseAction(org: string, tripId: string, expenseId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    await voidExpense(await requireTrip(org, tripId), expenseId, String(fd.get("reason") ?? ""));
    revalidatePath(path(org, tripId), "layout");
  });
}

export async function attachReceiptAction(org: string, tripId: string, expenseId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    await attachExpenseReceipt(await requireTrip(org, tripId), expenseId, fd.get("receipt") as File | null);
    revalidatePath(path(org, tripId, "/finances"));
  });
}

export async function setBudgetAction(org: string, tripId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    await setBudgetLines(await requireTrip(org, tripId), fd);
    revalidatePath(path(org, tripId), "layout");
    return { ok: true, message: "Budget saved." };
  });
}

export async function publishReportAction(org: string, tripId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    await publishFinancialReport(await requireTrip(org, tripId), formObject(fd) as never);
    revalidatePath(path(org, tripId), "layout");
    return { ok: true, message: "Report published to the public trip page." };
  });
}
