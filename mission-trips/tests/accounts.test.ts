import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { signUp, logIn, requestPasswordReset, resetPassword, sendVerificationEmail, verifyEmail } from "@/server/services/accounts";
import { validateSessionToken } from "@/server/auth/session";
import { safeNextPath } from "@/server/auth/cookies";
import { encryptJson, decryptJson } from "@/server/crypto";
import { parseMoneyToCents, formatMoney } from "@/lib/money";
import { resetDb } from "./helpers/factory";

beforeEach(resetDb);

describe("accounts", () => {
  it("signs up, normalizes email, and creates a working session", async () => {
    const { user, session } = await signUp({ name: "Ana", email: "  Ana@Example.TEST ", password: "long-enough-pw" });
    expect(user.email).toBe("ana@example.test");
    expect(user.passwordHash).not.toContain("long-enough-pw");
    expect((await validateSessionToken(session.token))?.user.id).toBe(user.id);
    // Only the hash of the token is stored
    expect(await db.session.count({ where: { tokenHash: session.token } })).toBe(0);
  });

  it("rejects short passwords and duplicate accounts", async () => {
    await expect(signUp({ name: "A", email: "a@example.test", password: "short" })).rejects.toThrow();
    await signUp({ name: "A", email: "a@example.test", password: "long-enough-pw" });
    await expect(signUp({ name: "A", email: "A@example.test", password: "long-enough-pw" })).rejects.toThrow(/already exists/);
  });

  it("gives the same error for unknown email and wrong password, and rate-limits guessing", async () => {
    await signUp({ name: "A", email: "a@example.test", password: "long-enough-pw" });
    const meta = { ip: "1.2.3.4" };
    await expect(logIn({ email: "nobody@example.test", password: "x" }, meta)).rejects.toThrow("That email and password don't match an account.");
    await expect(logIn({ email: "a@example.test", password: "wrong-password" }, meta)).rejects.toThrow("That email and password don't match an account.");
    for (let i = 0; i < 9; i++) await logIn({ email: "a@example.test", password: "wrong" }, meta).catch(() => undefined);
    await expect(logIn({ email: "a@example.test", password: "long-enough-pw" }, meta)).rejects.toThrow(/Too many/);
  });

  it("verifies email with a single-use token", async () => {
    const { user } = await signUp({ name: "A", email: "a@example.test", password: "long-enough-pw" });
    const token = (await sendVerificationEmail(user.id))!;
    await verifyEmail(token);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
    await expect(verifyEmail(token)).rejects.toThrow(/invalid or has expired/);
  });

  it("resets a password once, signs out everywhere, and never reveals whether an email exists", async () => {
    const { user, session } = await signUp({ name: "A", email: "a@example.test", password: "long-enough-pw" });
    expect(await requestPasswordReset("nobody@example.test")).toBeUndefined();
    const token = (await requestPasswordReset("a@example.test"))!;
    await resetPassword(token, "brand-new-password");
    expect(await validateSessionToken(session.token)).toBeNull();
    await expect(resetPassword(token, "another-password")).rejects.toThrow(/invalid or has expired/);
    await logIn({ email: "a@example.test", password: "brand-new-password" }, {});
    expect(user.id).toBeTruthy();
  });

  it("rejects expired sessions", async () => {
    const { session, user } = await signUp({ name: "A", email: "a@example.test", password: "long-enough-pw" });
    await db.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSessionToken(session.token)).toBeNull();
  });

  it("only redirects to paths on this site after login", () => {
    expect(safeNextPath("/o/grace")).toBe("/o/grace");
    expect(safeNextPath("https://evil.example")).toBe("/home");
    expect(safeNextPath("//evil.example")).toBe("/home");
    expect(safeNextPath("/\\evil.example")).toBe("/home");
  });
});

describe("helpers", () => {
  it("parses money strictly into cents", () => {
    expect(parseMoneyToCents("1,250.5")).toBe(125050);
    expect(parseMoneyToCents("$40")).toBe(4000);
    expect(parseMoneyToCents("0.1")).toBe(10);
    expect(parseMoneyToCents("-5")).toBeNull();
    expect(parseMoneyToCents("1.234")).toBeNull();
    expect(parseMoneyToCents("1e5")).toBeNull();
    expect(formatMoney(123456)).toBe("$1,234.56");
  });

  it("round-trips encrypted data and detects tampering", () => {
    const enc = encryptJson({ a: "secret" });
    expect(decryptJson(enc)).toEqual({ a: "secret" });
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptJson(parts.join("."))).toThrow();
  });
});
