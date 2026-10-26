import "server-only";
import { notFound } from "next/navigation";
import { AppError } from "./errors";
import { requireOrg, requireTrip, type OrgContext, type TripContext } from "./context";

/** Pages show "not found" for both missing and forbidden records, so nothing leaks. */
async function guard<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
}

export function pageOrg(orgSlug: string): Promise<OrgContext> {
  return guard(requireOrg(orgSlug));
}

export async function pageOrgAdmin(orgSlug: string): Promise<OrgContext> {
  const ctx = await pageOrg(orgSlug);
  if (!ctx.isAdmin) notFound();
  return ctx;
}

export function pageTrip(orgSlug: string, tripId: string): Promise<TripContext> {
  return guard(requireTrip(orgSlug, tripId));
}
