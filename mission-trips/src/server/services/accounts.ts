import "server-only";
import { z } from "zod";
import { db } from "../db";
import { hashToken, newToken } from "../crypto";
import { hashPassword, verifyPassword, burnPasswordCheck, needsRehash, PASSWORD_MIN_LENGTH } from "../auth/password";
import { createSession, deleteAllSessionsForUser } from "../auth/session";
import { AppError, conflict, invalid } from "../errors";
import { rateLimit } from "../rate-limit";
import { appUrl, queueEmail } from "../email";
import { zEmail, zName } from "@/lib/validation";
import { Prisma } from "@/generated/prisma/client";

export const zPassword = z
  .string({ error: "Password is required." })
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(200, "That password is too long.");

export const signupSchema = z.object({ name: zName("Your name"), email: zEmail, password: zPassword });

export async function signUp(input: z.input<typeof signupSchema>, userAgent?: string | null) {
  const data = signupSchema.parse(input);
  const limited = rateLimit(`signup:${data.email}`, 5, 60 * 60 * 1000);
  if (!limited.ok) throw new AppError("Too many attempts. Please try again later.", "INVALID");
  try {
    const user = await db.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: await hashPassword(data.password),
        preferences: { create: {} },
      },
    });
    await sendVerificationEmail(user.id);
    const session = await createSession(user.id, userAgent);
    return { user, session };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw conflict("An account with that email already exists. Try signing in instead.");
    }
    throw e;
  }
}

export const loginSchema = z.object({ email: zEmail, password: z.string().min(1, "Password is required.").max(200) });

export async function logIn(input: z.input<typeof loginSchema>, meta: { ip?: string | null; userAgent?: string | null }) {
  const data = loginSchema.parse(input);
  const byEmail = rateLimit(`login:${data.email}`, 10, 15 * 60 * 1000);
  const byIp = rateLimit(`login-ip:${meta.ip ?? "unknown"}`, 50, 15 * 60 * 1000);
  if (!byEmail.ok || !byIp.ok) {
    throw new AppError("Too many sign-in attempts. Please wait a few minutes and try again.", "INVALID");
  }
  const user = await db.user.findUnique({ where: { email: data.email } });
  if (!user) {
    await burnPasswordCheck(data.password);
    throw invalid("That email and password don't match an account.");
  }
  if (!(await verifyPassword(data.password, user.passwordHash))) {
    throw invalid("That email and password don't match an account.");
  }
  // Keep stored hashes at the configured work factor (only possible here, while we have the password).
  if (needsRehash(user.passwordHash)) {
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(data.password) } });
  }
  const session = await createSession(user.id, meta.userAgent);
  return { user, session };
}

// ── Email verification & password reset ──

const VERIFY_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

export async function sendVerificationEmail(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) return;
  const token = newToken();
  await db.userToken.create({
    data: { userId, kind: "EMAIL_VERIFICATION", tokenHash: hashToken(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
  });
  await queueEmail({
    to: user.email,
    subject: "Confirm your email address",
    text: `Hi ${user.name},\n\nPlease confirm your email address by opening this link:\n${appUrl(`/verify-email?token=${token}`)}\n\nThe link expires in 3 days. If you didn't create an account, you can ignore this email.`,
  });
  return token; // returned for tests; never shown in the UI
}

export async function verifyEmail(token: string) {
  const row = await consumeToken(token, "EMAIL_VERIFICATION");
  await db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
  return row.userId;
}

export async function requestPasswordReset(emailInput: string) {
  const email = zEmail.parse(emailInput);
  const limited = rateLimit(`reset:${email}`, 3, 60 * 60 * 1000);
  if (!limited.ok) return; // silently: never reveal whether the account exists
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return;
  const token = newToken();
  await db.userToken.create({
    data: { userId: user.id, kind: "PASSWORD_RESET", tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
  });
  await queueEmail({
    to: user.email,
    subject: "Reset your password",
    text: `Hi ${user.name},\n\nUse this link to choose a new password. It expires in 1 hour.\n${appUrl(`/reset-password?token=${token}`)}\n\nIf you didn't ask for this, you can ignore this email; your password hasn't changed.`,
  });
  return token;
}

export async function resetPassword(token: string, newPassword: string) {
  const password = zPassword.parse(newPassword);
  const row = await consumeToken(token, "PASSWORD_RESET");
  await db.user.update({
    where: { id: row.userId },
    // A successful reset also proves the person controls the email address.
    data: { passwordHash: await hashPassword(password), emailVerifiedAt: new Date() },
  });
  await deleteAllSessionsForUser(row.userId); // sign out everywhere
  return row.userId;
}

async function consumeToken(token: string, kind: "EMAIL_VERIFICATION" | "PASSWORD_RESET") {
  if (!token || token.length > 200) throw invalid("This link is invalid or has expired.");
  // Atomic: only one request can consume a token.
  const now = new Date();
  const row = await db.userToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.kind !== kind || row.consumedAt || row.expiresAt <= now) {
    throw invalid("This link is invalid or has expired.");
  }
  const updated = await db.userToken.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: now },
  });
  if (updated.count !== 1) throw invalid("This link is invalid or has expired.");
  return row;
}

export async function updatePreferences(userId: string, prefs: { emailDonations: boolean; emailAnnouncements: boolean; emailDeadlines: boolean; emailStories: boolean; emailTravel: boolean; emailReports: boolean }) {
  await db.notificationPreference.upsert({ where: { userId }, create: { userId, ...prefs }, update: prefs });
}
