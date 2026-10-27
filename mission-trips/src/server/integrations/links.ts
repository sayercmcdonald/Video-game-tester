import "server-only";
import { db } from "../db";
import { audit } from "../audit";
import { encryptJson, decryptJson } from "../crypto";
import type { IntegrationProvider, RecordOwner } from "@/generated/prisma/client";

// Shared plumbing every live adapter uses. Kept small and tested now so the
// first real integration (Planning Center) builds on proven pieces.

/**
 * Records that a Sent record corresponds to a record in another system.
 * Idempotent: syncing the same external record twice returns the same link
 * rather than creating a duplicate.
 */
export async function linkExternal(input: { orgId: string; provider: IntegrationProvider; entityType: string; entityId: string; externalId: string; owner: RecordOwner }) {
  const existing = await db.externalLink.findUnique({
    where: { orgId_provider_entityType_externalId: { orgId: input.orgId, provider: input.provider, entityType: input.entityType, externalId: input.externalId } },
  });
  if (existing) {
    if (existing.entityId !== input.entityId) {
      throw new Error(`${input.provider} ${input.entityType} ${input.externalId} is already linked to a different Sent record`);
    }
    return db.externalLink.update({ where: { id: existing.id }, data: { lastSyncedAt: new Date() } });
  }
  return db.externalLink.create({ data: input });
}

export async function findLinkedEntity(orgId: string, provider: IntegrationProvider, entityType: string, externalId: string) {
  const link = await db.externalLink.findUnique({ where: { orgId_provider_entityType_externalId: { orgId, provider, entityType, externalId } } });
  return link?.entityId ?? null;
}

/** Stores provider credentials encrypted. They are never sent back to the browser. */
export async function saveCredentials(orgId: string, provider: IntegrationProvider, actorUserId: string, credentials: Record<string, string>) {
  const row = await db.integration.upsert({
    where: { orgId_provider: { orgId, provider } },
    create: { orgId, provider, credentialsEncrypted: encryptJson(credentials) },
    update: { credentialsEncrypted: encryptJson(credentials), status: "NOT_CONNECTED", lastError: null },
  });
  await audit({ orgId, actorUserId, action: "integration.credentials_saved", entityType: "Integration", entityId: row.id, metadata: { provider } });
  return row.id;
}

export async function loadCredentials(orgId: string, provider: IntegrationProvider): Promise<Record<string, string> | null> {
  const row = await db.integration.findUnique({ where: { orgId_provider: { orgId, provider } } });
  return row?.credentialsEncrypted ? decryptJson<Record<string, string>>(row.credentialsEncrypted) : null;
}
