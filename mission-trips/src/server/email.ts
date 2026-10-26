import "server-only";
import { db } from "./db";
import { env } from "./env";
import { Prisma } from "@/generated/prisma/client";

// Emails go into an outbox table first, then are delivered. If delivery fails,
// the job runner retries, and nothing is lost if the provider is down.

export async function queueEmail(input: { to: string; subject: string; text: string; dedupeKey?: string }) {
  try {
    const row = await db.emailOutbox.create({
      data: { to: input.to, subject: input.subject, text: input.text, dedupeKey: input.dedupeKey ?? null },
    });
    // Best-effort immediate delivery; failures stay QUEUED for the job runner.
    void deliver(row.id).catch((e) => console.error("[email] delivery failed", e));
    return row;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null; // already sent
    throw e;
  }
}

export async function deliver(id: string): Promise<void> {
  const row = await db.emailOutbox.findUnique({ where: { id } });
  if (!row || row.status === "SENT") return;
  const config = env();
  try {
    if (config.EMAIL_TRANSPORT === "resend") {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: config.EMAIL_FROM, to: row.to, subject: row.subject, text: row.text }),
      });
      if (!res.ok) throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
    } else if (config.APP_ENV !== "test") {
      console.info(`\n[email:log] To: ${row.to}\nSubject: ${row.subject}\n\n${row.text}\n`);
    }
    await db.emailOutbox.update({
      where: { id },
      data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
    });
  } catch (err) {
    const attempts = row.attempts + 1;
    await db.emailOutbox.update({
      where: { id },
      data: { attempts, lastError: String(err).slice(0, 1000), status: attempts >= 5 ? "FAILED" : "QUEUED" },
    });
    throw err;
  }
}

/** Retries queued emails. Called by the scheduled job runner. */
export async function deliverQueuedEmails(limit = 50) {
  const rows = await db.emailOutbox.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let sent = 0;
  for (const r of rows) {
    try {
      await deliver(r.id);
      sent++;
    } catch {
      /* recorded on the row */
    }
  }
  return { attempted: rows.length, sent };
}

export function appUrl(path: string): string {
  return new URL(path, env().APP_URL).toString();
}
