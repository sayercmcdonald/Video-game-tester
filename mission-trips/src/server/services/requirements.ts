import "server-only";
import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import { assertPerm, type TripContext } from "../context";
import { invalid, notFound } from "../errors";
import { notifyUsers } from "../notify";
import { validateUpload } from "../storage";
import { storeDocument } from "./documents";
import { tripManagerUserIds } from "./trips";
import { zCheckbox, zName, zOptionalDate, zOptionalText } from "@/lib/validation";
import type { Requirement, RequirementSubmission } from "@/generated/prisma/client";

// ── Configurable form fields ──

export type FormField = { key: string; label: string; type: "text" | "yesno"; required: boolean };

/**
 * Leaders write one question per line. Add "(optional)" to make a question
 * optional and "[yes/no]" for a yes/no answer.
 */
export function parseFormFieldLines(text: string): FormField[] {
  const fields = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((line, i) => {
      const optional = /\(optional\)/i.test(line);
      const yesno = /\[yes\/no\]/i.test(line);
      const label = line.replace(/\(optional\)/gi, "").replace(/\[yes\/no\]/gi, "").trim().slice(0, 200);
      return { key: `q${i + 1}`, label, type: yesno ? ("yesno" as const) : ("text" as const), required: !optional };
    })
    .filter((f) => f.label.length > 0);
  return fields;
}

export function formFieldsToLines(fields: FormField[] | null | undefined): string {
  return (fields ?? []).map((f) => `${f.label}${f.type === "yesno" ? " [yes/no]" : ""}${f.required ? "" : " (optional)"}`).join("\n");
}

export function readFormFields(r: Pick<Requirement, "formFields">): FormField[] {
  return Array.isArray(r.formFields) ? (r.formFields as unknown as FormField[]) : [];
}

// ── Managing requirements ──

export const requirementSchema = z.object({
  kind: z.enum(["UPLOAD", "WAIVER", "FORM", "TASK"]),
  title: zName("Title", 150),
  instructions: zOptionalText(5000),
  waiverText: zOptionalText(20_000),
  formQuestions: zOptionalText(5000),
  dueDate: zOptionalDate("Due date"),
  needsReview: zCheckbox,
  isRequired: zCheckbox,
});

export async function createRequirement(t: TripContext, input: z.input<typeof requirementSchema>, templateFile?: File | null) {
  assertPerm(t.perms.manage);
  const d = requirementSchema.parse(input);
  if (d.kind === "WAIVER" && !d.waiverText) throw invalid("Paste the waiver text participants will sign.");
  const formFields = d.kind === "FORM" ? parseFormFieldLines(d.formQuestions ?? "") : null;
  if (d.kind === "FORM" && (!formFields || formFields.length === 0)) throw invalid("Add at least one question, one per line.");
  const upload = templateFile && templateFile.size > 0 ? await validateUpload(templateFile) : null;

  const req = await db.$transaction(async (tx) => {
    const template = upload
      ? await storeDocument(tx, upload, { orgId: t.org.id, tripId: t.trip.id, ownerUserId: null, kind: "REQUIREMENT_TEMPLATE", uploadedById: t.user.id })
      : null;
    const count = await tx.requirement.count({ where: { tripId: t.trip.id } });
    return tx.requirement.create({
      data: {
        orgId: t.org.id,
        tripId: t.trip.id,
        kind: d.kind,
        title: d.title,
        instructions: d.instructions ?? "",
        waiverText: d.kind === "WAIVER" ? d.waiverText! : null,
        formFields: formFields ?? undefined,
        needsReview: d.needsReview,
        isRequired: d.isRequired,
        dueDate: d.dueDate ?? null,
        sortOrder: count,
        templateDocumentId: template?.id ?? null,
      },
    });
  });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "requirement.created", entityType: "Requirement", entityId: req.id });
  const participants = await db.tripMember.findMany({ where: { tripId: t.trip.id, role: "PARTICIPANT", status: "APPROVED" }, select: { userId: true } });
  await notifyUsers({
    userIds: participants.map((p) => p.userId),
    orgId: t.org.id,
    title: `New requirement: ${req.title}`,
    body: `${t.trip.name} has a new requirement: "${req.title}".${req.dueDate ? ` Due ${req.dueDate.toISOString().slice(0, 10)}.` : ""}`,
    href: `/o/${t.org.slug}/trips/${t.trip.id}/requirements`,
    category: "deadlines",
  });
  return req;
}

export async function deleteRequirement(t: TripContext, requirementId: string) {
  assertPerm(t.perms.manage);
  const req = await db.requirement.findFirst({ where: { id: requirementId, tripId: t.trip.id, orgId: t.org.id }, include: { _count: { select: { submissions: true } } } });
  if (!req) throw notFound("Requirement");
  if (req._count.submissions > 0) {
    throw invalid("Participants have already submitted this. Mark it as not required instead of deleting it, so their records are kept.");
  }
  await db.requirement.delete({ where: { id: req.id } });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "requirement.deleted", entityType: "Requirement", entityId: req.id });
}

export async function setRequirementRequired(t: TripContext, requirementId: string, isRequired: boolean) {
  assertPerm(t.perms.manage);
  const res = await db.requirement.updateMany({ where: { id: requirementId, tripId: t.trip.id, orgId: t.org.id }, data: { isRequired } });
  if (res.count === 0) throw notFound("Requirement");
}

// ── Participants completing requirements ──

export async function submitRequirement(t: TripContext, requirementId: string, fd: FormData) {
  if (!t.tripMember || t.tripMember.status !== "APPROVED") throw invalid("Only approved team members can submit requirements.");
  const req = await db.requirement.findFirst({ where: { id: requirementId, tripId: t.trip.id, orgId: t.org.id } });
  if (!req) throw notFound("Requirement");
  const existing = await db.requirementSubmission.findUnique({
    where: { requirementId_tripMemberId: { requirementId: req.id, tripMemberId: t.tripMember.id } },
  });
  if (existing?.status === "APPROVED") throw invalid("This is already complete. Ask a leader if something needs to change.");

  let signedName: string | null = null;
  let formAnswers: Record<string, string> | null = null;
  let upload = null;
  switch (req.kind) {
    case "UPLOAD":
      upload = await validateUpload(fd.get("file") as File | null);
      break;
    case "WAIVER": {
      signedName = String(fd.get("signedName") ?? "").trim();
      if (fd.get("agree") !== "on") throw invalid("Check the box to confirm you've read and agree.");
      if (signedName.toLowerCase().replace(/\s+/g, " ") !== t.user.name.toLowerCase().replace(/\s+/g, " ")) {
        throw invalid(`Type your full name exactly as it appears on your account: ${t.user.name}`);
      }
      break;
    }
    case "FORM": {
      formAnswers = {};
      for (const f of readFormFields(req)) {
        const v = String(fd.get(f.key) ?? "").trim().slice(0, 5000);
        if (f.required && !v) throw invalid(`Please answer: ${f.label}`);
        if (f.type === "yesno" && v && v !== "yes" && v !== "no") throw invalid(`Answer yes or no: ${f.label}`);
        formAnswers[f.key] = v;
      }
      break;
    }
    case "TASK":
      break;
  }

  const status = req.needsReview ? "SUBMITTED" : "APPROVED";
  const tripMemberId = t.tripMember.id;
  const submission = await db.$transaction(async (tx) => {
    const doc = upload
      ? await storeDocument(tx, upload, { orgId: t.org.id, tripId: t.trip.id, ownerUserId: t.user.id, kind: "SUBMISSION", uploadedById: t.user.id })
      : null;
    const data = {
      status,
      documentId: doc?.id ?? null,
      signedName,
      formAnswers: formAnswers ?? undefined,
      submittedAt: new Date(),
      reviewedAt: status === "APPROVED" ? new Date() : null,
      reviewedById: null,
      reviewNote: null,
    } as const;
    return tx.requirementSubmission.upsert({
      where: { requirementId_tripMemberId: { requirementId: req.id, tripMemberId } },
      create: { orgId: t.org.id, requirementId: req.id, tripMemberId, ...data },
      update: data,
    });
  });
  await audit({
    orgId: t.org.id,
    actorUserId: t.user.id,
    action: req.kind === "WAIVER" ? "waiver.signed" : "requirement.submitted",
    entityType: "RequirementSubmission",
    entityId: submission.id,
    metadata: req.kind === "WAIVER" ? { signedName, waiverTextLength: req.waiverText?.length ?? 0 } : undefined,
  });
  if (status === "SUBMITTED") {
    await notifyUsers({
      userIds: await tripManagerUserIds(t.trip.id, t.org.id),
      orgId: t.org.id,
      title: `Ready for review: ${req.title}`,
      body: `${t.user.name} submitted "${req.title}" for ${t.trip.name}.`,
      href: `/o/${t.org.slug}/trips/${t.trip.id}/requirements`,
      category: "deadlines",
    });
  }
  return submission;
}

export async function reviewSubmission(t: TripContext, submissionId: string, decision: "APPROVED" | "CHANGES_REQUESTED", note?: string) {
  assertPerm(t.perms.manage);
  const sub = await db.requirementSubmission.findFirst({
    where: { id: submissionId, orgId: t.org.id, requirement: { tripId: t.trip.id } },
    include: { requirement: true, tripMember: true },
  });
  if (!sub) throw notFound("Submission");
  const cleanNote = z.string().trim().max(2000).optional().parse(note || undefined);
  if (decision === "CHANGES_REQUESTED" && !cleanNote) throw invalid("Tell the participant what needs to change.");
  await db.requirementSubmission.update({
    where: { id: sub.id },
    data: { status: decision, reviewedAt: new Date(), reviewedById: t.user.id, reviewNote: cleanNote ?? null },
  });
  await audit({ orgId: t.org.id, actorUserId: t.user.id, action: "requirement.reviewed", entityType: "RequirementSubmission", entityId: sub.id, metadata: { decision } });
  await notifyUsers({
    userIds: [sub.tripMember.userId],
    orgId: t.org.id,
    title: decision === "APPROVED" ? `Approved: ${sub.requirement.title}` : `Changes needed: ${sub.requirement.title}`,
    body: decision === "APPROVED" ? `"${sub.requirement.title}" is complete for ${t.trip.name}.` : `A leader asked for changes to "${sub.requirement.title}": ${cleanNote}`,
    href: `/o/${t.org.slug}/trips/${t.trip.id}/requirements`,
    category: "deadlines",
  });
}

// ── Readiness ──

export type ReadinessCell = { requirement: Requirement; submission: RequirementSubmission | null; state: "NOT_STARTED" | RequirementSubmission["status"] };

export function cellState(sub: RequirementSubmission | null): ReadinessCell["state"] {
  return sub ? sub.status : "NOT_STARTED";
}

/** Share of required items complete, 0–100. */
export function readinessPercent(cells: { requirement: { isRequired: boolean }; state: string }[]): number {
  const required = cells.filter((c) => c.requirement.isRequired);
  if (required.length === 0) return 100;
  return Math.round((required.filter((c) => c.state === "APPROVED").length / required.length) * 100);
}

export async function tripReadiness(tripId: string, orgId: string) {
  const [requirements, members] = await Promise.all([
    db.requirement.findMany({ where: { tripId, orgId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    db.tripMember.findMany({
      where: { tripId, orgId, role: "PARTICIPANT", status: "APPROVED" },
      include: { user: { select: { id: true, name: true, email: true } }, submissions: true },
      orderBy: { user: { name: "asc" } },
    }),
  ]);
  const rows = members.map((m) => {
    const cells: ReadinessCell[] = requirements.map((r) => {
      const submission = m.submissions.find((s) => s.requirementId === r.id) ?? null;
      return { requirement: r, submission, state: cellState(submission) };
    });
    return { member: m, cells, percent: readinessPercent(cells) };
  });
  return { requirements, rows };
}

/** One participant's checklist. */
export async function myRequirements(t: TripContext) {
  const requirements = await db.requirement.findMany({
    where: { tripId: t.trip.id, orgId: t.org.id },
    include: { template: { select: { id: true, filename: true } } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const subs = t.tripMember
    ? await db.requirementSubmission.findMany({ where: { tripMemberId: t.tripMember.id }, include: { document: { select: { id: true, filename: true } } } })
    : [];
  return requirements.map((r) => {
    const submission = subs.find((s) => s.requirementId === r.id) ?? null;
    return { requirement: r, submission, state: cellState(submission) };
  });
}
