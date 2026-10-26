"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { run, formObject, type ActionState } from "@/server/actions";
import { requireOrg, requireTrip, requireUser } from "@/server/context";
import { createOrganization, createInvitation, revokeInvitation, setMemberRole, removeMember, updateOrgSettings } from "@/server/services/orgs";
import { createTrip, updateTrip, setTripStatus, decideApplication, addLeader, removeFromTrip, addItineraryItem, deleteItineraryItem, applyToTrip } from "@/server/services/trips";
import { updateOwnProfile } from "@/server/services/profiles";
import { startStripeOnboarding } from "@/server/services/platform";
import { stripeGateway } from "@/server/payments/gateway";
import type { TripStatus } from "@/generated/prisma/client";

// ── Church ──

export async function createOrgAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let slug = "";
  const res = await run(async () => {
    const user = await requireUser();
    const org = await createOrganization(user, formObject(fd) as never);
    slug = org.slug;
  });
  if (res?.ok) redirect(`/o/${slug}`);
  return res;
}

export async function updateOrgSettingsAction(org: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    const ctx = await requireOrg(org);
    await updateOrgSettings(ctx, formObject(fd) as never);
    revalidatePath(`/o/${org}`, "layout");
    return { ok: true, message: "Settings saved." };
  });
}

export async function startPaymentsOnboardingAction(org: string, _prev: ActionState): Promise<ActionState> {
  let url = "";
  const res = await run(async () => {
    url = await startStripeOnboarding(stripeGateway, await requireOrg(org));
  });
  if (res?.ok && url) redirect(url);
  return res;
}

// ── People ──

export async function inviteAction(org: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    const ctx = await requireOrg(org);
    const f = formObject(fd);
    await createInvitation(ctx, { email: f.email ?? "", orgRole: (f.orgRole as "ADMIN" | "MEMBER") ?? "MEMBER", tripId: f.tripId, tripRole: f.tripRole as "LEADER" | "PARTICIPANT" | undefined });
    revalidatePath(`/o/${org}`, "layout");
    return { ok: true, message: `Invitation sent to ${f.email}.` };
  });
}

export async function revokeInviteAction(org: string, invitationId: string, _prev: ActionState) {
  return run(async () => {
    await revokeInvitation(await requireOrg(org), invitationId);
    revalidatePath(`/o/${org}/people`);
  });
}

export async function setRoleAction(org: string, membershipId: string, role: "ADMIN" | "MEMBER", _prev: ActionState) {
  return run(async () => {
    await setMemberRole(await requireOrg(org), membershipId, role);
    revalidatePath(`/o/${org}/people`);
  });
}

export async function removeMemberAction(org: string, membershipId: string, _prev: ActionState) {
  return run(async () => {
    await removeMember(await requireOrg(org), membershipId);
    revalidatePath(`/o/${org}/people`);
  });
}

export async function updateProfileAction(org: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    await updateOwnProfile(await requireOrg(org), formObject(fd) as never);
    revalidatePath(`/o/${org}/profile`);
    return { ok: true, message: "Your profile was saved." };
  });
}

// ── Trips ──

export async function createTripAction(org: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await run(async () => {
    const trip = await createTrip(await requireOrg(org), formObject(fd) as never);
    id = trip.id;
  });
  if (res?.ok) redirect(`/o/${org}/trips/${id}`);
  return res;
}

export async function updateTripAction(org: string, tripId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    await updateTrip(await requireTrip(org, tripId), formObject(fd) as never);
    revalidatePath(`/o/${org}/trips/${tripId}`, "layout");
    return { ok: true, message: "Trip saved." };
  });
}

export async function setTripStatusAction(org: string, tripId: string, status: TripStatus, _prev: ActionState) {
  return run(async () => {
    await setTripStatus(await requireTrip(org, tripId), status);
    revalidatePath(`/o/${org}/trips/${tripId}`, "layout");
  });
}

export async function decideApplicationAction(org: string, tripId: string, tripMemberId: string, decision: "APPROVED" | "WAITLISTED" | "DECLINED", _prev: ActionState) {
  return run(async () => {
    await decideApplication(await requireTrip(org, tripId), tripMemberId, decision);
    revalidatePath(`/o/${org}/trips/${tripId}`, "layout");
  });
}

export async function addLeaderAction(org: string, tripId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    const userId = String(fd.get("userId") ?? "");
    if (!userId) return { ok: false, error: "Choose a person." };
    await addLeader(await requireTrip(org, tripId), userId);
    revalidatePath(`/o/${org}/trips/${tripId}`, "layout");
    return { ok: true, message: "Leader added." };
  });
}

export async function removeFromTripAction(org: string, tripId: string, tripMemberId: string, _prev: ActionState) {
  return run(async () => {
    await removeFromTrip(await requireTrip(org, tripId), tripMemberId);
    revalidatePath(`/o/${org}/trips/${tripId}`, "layout");
  });
}

export async function addItineraryAction(org: string, tripId: string, _prev: ActionState, fd: FormData) {
  return run(async () => {
    await addItineraryItem(await requireTrip(org, tripId), formObject(fd) as never);
    revalidatePath(`/o/${org}/trips/${tripId}/itinerary`);
    return { ok: true, message: "Added to the itinerary." };
  });
}

export async function deleteItineraryAction(org: string, tripId: string, itemId: string, _prev: ActionState) {
  return run(async () => {
    await deleteItineraryItem(await requireTrip(org, tripId), itemId);
    revalidatePath(`/o/${org}/trips/${tripId}/itinerary`);
  });
}

export async function applyAction(org: string, tripId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = await run(async () => {
    await applyToTrip(await requireUser(), org, tripId, String(fd.get("note") ?? ""));
  });
  if (res?.ok) redirect(`/o/${org}/trips/${tripId}`);
  return res;
}
