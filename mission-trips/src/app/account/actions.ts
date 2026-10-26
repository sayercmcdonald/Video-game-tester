"use server";

import { revalidatePath } from "next/cache";
import { run, type ActionState } from "@/server/actions";
import { requireUser } from "@/server/context";
import { updatePreferences } from "@/server/services/accounts";
import { db } from "@/server/db";
import { setOrganizationStatus } from "@/server/services/platform";
import type { OrgStatus } from "@/generated/prisma/client";

export async function savePreferencesAction(_prev: ActionState, fd: FormData) {
  return run(async () => {
    const user = await requireUser();
    await updatePreferences(user.id, {
      emailDonations: fd.get("emailDonations") === "on",
      emailAnnouncements: fd.get("emailAnnouncements") === "on",
      emailDeadlines: fd.get("emailDeadlines") === "on",
    });
    return { ok: true, message: "Email preferences saved." };
  });
}

export async function markAllReadAction(_prev: ActionState) {
  return run(async () => {
    const user = await requireUser();
    await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    revalidatePath("/", "layout");
  });
}

export async function setOrgStatusAction(orgId: string, status: OrgStatus, _prev: ActionState) {
  return run(async () => {
    await setOrganizationStatus(await requireUser(), orgId, status);
    revalidatePath("/admin");
  });
}
