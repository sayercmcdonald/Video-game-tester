import "server-only";
import { db } from "../db";
import { hashToken, newToken } from "../crypto";

export const SESSION_COOKIE = "mt_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000; // extend at most once a day

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  platformRole: "USER" | "PLATFORM_ADMIN";
  emailVerifiedAt: Date | null;
};

/** Creates a session and returns the raw token for the cookie. Only its hash is stored. */
export async function createSession(userId: string, userAgent?: string | null) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt, userAgent: userAgent?.slice(0, 300) ?? null },
  });
  return { token, expiresAt };
}

/** Returns the user for a valid token, sliding the expiry forward when due. */
export async function validateSessionToken(token: string): Promise<{ user: SessionUser; expiresAt: Date } | null> {
  if (!token || token.length > 200) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: { select: { id: true, email: true, name: true, platformRole: true, emailVerifiedAt: true } },
    },
  });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  let expiresAt = session.expiresAt;
  if (now - session.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    expiresAt = new Date(now + SESSION_TTL_MS);
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now), expiresAt } });
  }
  return { user: session.user, expiresAt };
}

export async function deleteSessionToken(token: string) {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function deleteAllSessionsForUser(userId: string) {
  await db.session.deleteMany({ where: { userId } });
}
