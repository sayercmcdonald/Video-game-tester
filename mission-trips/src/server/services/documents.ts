import "server-only";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { canAccessDocument, tripPermissions } from "../permissions";
import { assertPerm, type TripContext } from "../context";
import { notFound } from "../errors";
import { putObject, validateUpload, deleteObject, type ValidatedUpload } from "../storage";
import type { DocumentKind } from "@/generated/prisma/client";
import type { SessionUser } from "../auth/session";

/** Stores a validated file and creates its Document row. */
export async function storeDocument(
  tx: Tx,
  upload: ValidatedUpload,
  meta: { orgId: string; tripId: string | null; ownerUserId: string | null; kind: DocumentKind; uploadedById: string },
) {
  const storageKey = await putObject(upload.buffer);
  try {
    return await tx.document.create({
      data: {
        ...meta,
        storageKey,
        filename: upload.filename,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        sha256: upload.sha256,
      },
    });
  } catch (e) {
    await deleteObject(storageKey);
    throw e;
  }
}

/** Shared trip resources (packing list, orientation guide). */
export async function uploadTripResource(t: TripContext, file: File | null) {
  assertPerm(t.perms.manage);
  const upload = await validateUpload(file);
  const doc = await db.$transaction((tx) =>
    storeDocument(tx, upload, { orgId: t.org.id, tripId: t.trip.id, ownerUserId: null, kind: "TRIP_RESOURCE", uploadedById: t.user.id }),
  );
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "document.uploaded", entityType: "Document", entityId: doc.id, metadata: { kind: "TRIP_RESOURCE" } });
  return doc;
}

export async function deleteTripResource(t: TripContext, documentId: string) {
  assertPerm(t.perms.manage);
  const doc = await db.document.findFirst({ where: { id: documentId, orgId: t.org.id, tripId: t.trip.id, kind: "TRIP_RESOURCE" } });
  if (!doc) throw notFound("Document");
  await db.document.delete({ where: { id: doc.id } });
  await deleteObject(doc.storageKey);
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "document.deleted", entityType: "Document", entityId: doc.id });
}

/**
 * Decides whether a signed-in user may download a document. Every download
 * of a participant's private file is written to the audit log.
 */
export async function authorizeDownload(user: SessionUser, documentId: string) {
  const doc = await db.document.findUnique({ where: { id: documentId } });
  if (!doc) return null;
  const membership = await db.membership.findUnique({ where: { orgId_userId: { orgId: doc.orgId, userId: user.id } }, include: { org: true } });
  if (!membership || membership.org.status === "SUSPENDED") return null;

  let perms = null;
  if (doc.tripId) {
    const trip = await db.trip.findUnique({ where: { id: doc.tripId } });
    const tm = await db.tripMember.findUnique({ where: { tripId_userId: { tripId: doc.tripId, userId: user.id } } });
    if (trip) {
      perms = tripPermissions({
        orgRole: membership.role,
        tripStatus: trip.status,
        leadersSeeFinances: trip.leadersSeeFinances,
        membership: tm ? { role: tm.role, status: tm.status } : null,
      });
      if (!perms.view) perms = null;
    }
  }
  const allowed = canAccessDocument({ kind: doc.kind, isOwner: doc.ownerUserId === user.id, perms, orgRole: membership.role });
  if (!allowed) return null;
  if (doc.kind === "SUBMISSION" && doc.ownerUserId !== user.id) {
    await audit({ orgId: doc.orgId, actorUserId: user.id, action: "document.viewed", entityType: "Document", entityId: doc.id });
  }
  return doc;
}
