import "server-only";
import { db, type Tx } from "./db";
import type { Prisma } from "@/generated/prisma/client";

export type AuditInput = {
  orgId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
};

/** Records who did what. Audit rows can never be edited (enforced by a database trigger). */
export async function audit(input: AuditInput, tx: Tx = db) {
  await tx.auditLog.create({ data: input });
}
