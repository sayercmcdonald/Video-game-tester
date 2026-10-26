"use server";

import { redirect } from "next/navigation";
import { run, type ActionState } from "@/server/actions";
import { requireUser } from "@/server/context";
import { acceptInvitation } from "@/server/services/orgs";

export async function acceptInviteAction(token: string, _prev: ActionState): Promise<ActionState> {
  let slug = "";
  const res = await run(async () => {
    slug = await acceptInvitation(await requireUser(), token);
  });
  if (res?.ok) redirect(`/o/${slug}`);
  return res;
}
