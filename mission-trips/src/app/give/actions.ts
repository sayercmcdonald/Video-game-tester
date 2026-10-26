"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { run, formObject, type ActionState } from "@/server/actions";
import { getCurrentUser } from "@/server/context";
import { startCheckout } from "@/server/services/donations";
import { stripeGateway } from "@/server/payments/gateway";
import { rateLimit } from "@/server/rate-limit";

export async function donateAction(orgSlug: string, campaignSlug: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  let url = "";
  const res = await run(async () => {
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    // Slows down automated "card testing" through the giving form.
    if (!rateLimit(`checkout:${ip}`, 10, 10 * 60 * 1000).ok) {
      return { ok: false, error: "Too many attempts from your network. Please wait a few minutes and try again." };
    }
    const f = formObject(fd);
    const amount = f.amount === "other" ? f.otherAmount : f.amount;
    const user = await getCurrentUser();
    const out = await startCheckout(stripeGateway, {
      orgSlug,
      campaignSlug,
      donorUserId: user?.id ?? null,
      form: { amount: amount ?? "", donorName: f.donorName ?? "", donorEmail: f.donorEmail ?? "", isAnonymous: f.isAnonymous, message: f.message },
    });
    url = out.url;
  });
  if (res?.ok && url) redirect(url); // to Stripe's hosted, secure payment page
  return res;
}
