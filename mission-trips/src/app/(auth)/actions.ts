"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { formAction, formObject } from "@/server/actions";
import { logIn, requestPasswordReset, resetPassword, sendVerificationEmail, signUp } from "@/server/services/accounts";
import { clearSessionCookie, safeNextPath, setSessionCookie } from "@/server/auth/cookies";
import { SESSION_COOKIE, deleteSessionToken } from "@/server/auth/session";
import { getCurrentUser } from "@/server/context";

async function requestMeta() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: h.get("user-agent") };
}

export const signupAction = formAction(async (fd) => {
  const f = formObject(fd);
  const { session } = await signUp({ name: f.name ?? "", email: f.email ?? "", password: (fd.get("password") as string) ?? "" }, (await requestMeta()).userAgent);
  await setSessionCookie(session.token, session.expiresAt);
  redirect(safeNextPath(f.next));
});

export const loginAction = formAction(async (fd) => {
  const f = formObject(fd);
  const { session } = await logIn({ email: f.email ?? "", password: (fd.get("password") as string) ?? "" }, await requestMeta());
  await setSessionCookie(session.token, session.expiresAt);
  redirect(safeNextPath(f.next));
});

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await deleteSessionToken(token);
  await clearSessionCookie();
  redirect("/login");
}

export const forgotPasswordAction = formAction(async (fd) => {
  await requestPasswordReset(formObject(fd).email ?? "");
  // Same answer whether or not the account exists.
  return { ok: true, message: "If an account exists for that email, we've sent a link to reset the password." };
});

export const resetPasswordAction = formAction(async (fd) => {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("confirm") ?? "")) return { ok: false, error: "The passwords don't match.", fieldErrors: { confirm: "Must match the new password." } };
  await resetPassword(token, password);
  await clearSessionCookie();
  redirect("/login?reset=1");
});

export const resendVerificationAction = formAction(async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await sendVerificationEmail(user.id);
  return { ok: true, message: "We sent a new confirmation link to your email." };
});
