import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./session";
import { env } from "../env";

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, // not readable by page scripts
    secure: env().APP_ENV === "production" || env().APP_ENV === "staging",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Only allow redirects to paths on this site (prevents "open redirect" phishing). */
export function safeNextPath(next: string | null | undefined, fallback = "/home"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
