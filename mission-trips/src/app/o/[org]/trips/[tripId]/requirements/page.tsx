import { notFound } from "next/navigation";
import { pageTrip } from "@/server/page-guard";
import type { TripContext } from "@/server/context";
import { db } from "@/server/db";
import { myRequirements, readFormFields, tripReadiness } from "@/server/services/requirements";
import { allowedTypesDescription } from "@/server/storage";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui";
import { ActionButton, ActionForm, CheckboxField, SelectField, SubmitButton, TextArea, TextField } from "@/components/forms";
import { RequirementForm } from "@/components/requirement-form";
import { formatDate, formatDateTime, daysUntil } from "@/lib/dates";
import { requirementKindLabel, submissionStatusLabel, submissionStatusTone } from "@/lib/labels";
import {
  createRequirementAction,
  deleteRequirementAction,
  reviewSubmissionAction,
  setRequirementRequiredAction,
  submitRequirementAction,
} from "../actions";

export const metadata = { title: "Requirements" };

export default async function RequirementsPage({ params }: { params: Promise<{ org: string; tripId: string }> }) {
  const { org, tripId } = await params;
  const t = await pageTrip(org, tripId);
  if (!t.perms.viewTeam) notFound();
  return t.perms.manage ? <ManagerView t={t} /> : <ParticipantView t={t} />;
}

function DueBadge({ date, done }: { date: Date | null; done: boolean }) {
  if (!date) return null;
  const days = daysUntil(date);
  const tone = done ? "neutral" : days < 0 ? "bad" : days <= 7 ? "warn" : "neutral";
  return <Badge tone={tone}>{done ? `Due ${formatDate(date)}` : days < 0 ? `Overdue · ${formatDate(date)}` : days === 0 ? "Due today" : `Due ${formatDate(date)}`}</Badge>;
}

async function ParticipantView({ t }: { t: TripContext }) {
  const items = await myRequirements(t);
  if (items.length === 0) return <EmptyState title="Nothing required yet">Your leaders will add forms, documents and tasks here.</EmptyState>;
  const action = (id: string) => submitRequirementAction.bind(null, t.org.slug, t.trip.id, id);
  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-ink-2">Complete each item below. Files you upload are private: only you, your trip leaders and church administrators can open them.</p>
      {items.map(({ requirement: r, submission: s, state }) => {
        const done = state === "APPROVED";
        const locked = done || state === "SUBMITTED";
        return (
          <Card key={r.id}>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {r.title}
                  {!r.isRequired && <Badge>Optional</Badge>}
                </span>
              }
              description={requirementKindLabel[r.kind]}
              action={
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={submissionStatusTone[state]}>{submissionStatusLabel[state]}</Badge>
                  <DueBadge date={r.dueDate} done={done} />
                </div>
              }
            />
            <CardBody className="space-y-4">
              {r.instructions && <p className="text-sm whitespace-pre-line text-ink-2">{r.instructions}</p>}
              {state === "CHANGES_REQUESTED" && s?.reviewNote && <Alert tone="bad" title="A leader asked for changes">{s.reviewNote}</Alert>}
              {r.template && (
                <a href={`/api/files/${r.template.id}`} className="inline-block text-sm text-accent underline">
                  Download blank form: {r.template.filename}
                </a>
              )}
              {s?.document && (
                <p className="text-sm">
                  Your file:{" "}
                  <a href={`/api/files/${s.document.id}`} className="text-accent underline">
                    {s.document.filename}
                  </a>
                </p>
              )}
              {r.kind === "WAIVER" && (
                <div className="max-h-64 overflow-y-auto rounded-md border border-line bg-subtle px-4 py-3 text-sm whitespace-pre-line">{r.waiverText}</div>
              )}
              {s?.signedName && (
                <p className="text-sm text-ink-2">
                  Signed as <strong>{s.signedName}</strong> on {formatDateTime(s.submittedAt, t.org.timezone)}
                </p>
              )}
              {!locked && (
                <ActionForm action={action(r.id)} className="space-y-3">
                  {r.kind === "UPLOAD" && <TextField label="Choose file" name="file" type="file" hint={allowedTypesDescription()} required />}
                  {r.kind === "WAIVER" && (
                    <>
                      <CheckboxField label="I have read and agree to the waiver above" name="agree" />
                      <TextField label="Type your full name to sign" name="signedName" hint={`Exactly as on your account: ${t.user.name}`} autoComplete="off" required />
                    </>
                  )}
                  {r.kind === "FORM" &&
                    readFormFields(r).map((f) =>
                      f.type === "yesno" ? (
                        <SelectField
                          key={f.key}
                          label={f.label}
                          name={f.key}
                          optional={!f.required}
                          options={[
                            { value: "", label: "Choose…" },
                            { value: "yes", label: "Yes" },
                            { value: "no", label: "No" },
                          ]}
                        />
                      ) : (
                        <TextArea key={f.key} label={f.label} name={f.key} rows={2} optional={!f.required} />
                      ),
                    )}
                  <SubmitButton pendingText="Submitting…">{r.kind === "TASK" ? "Mark as done" : r.kind === "WAIVER" ? "Sign waiver" : "Submit"}</SubmitButton>
                </ActionForm>
              )}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

async function ManagerView({ t }: { t: TripContext }) {
  const slug = t.org.slug;
  const [{ requirements, rows }, toReview] = await Promise.all([
    tripReadiness(t.trip.id, t.org.id),
    db.requirementSubmission.findMany({
      where: { status: "SUBMITTED", requirement: { tripId: t.trip.id } },
      include: { requirement: true, tripMember: { include: { user: { select: { name: true } } } }, document: { select: { id: true, filename: true } } },
      orderBy: { submittedAt: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      {toReview.length > 0 && (
        <Card>
          <CardHeader title="Waiting for review" description="Opening a participant's file is recorded in the activity log." />
          <ul className="divide-y divide-line">
            {toReview.map((s) => {
              const fields = readFormFields(s.requirement);
              const answers = (s.formAnswers ?? {}) as Record<string, string>;
              return (
                <li key={s.id} className="px-5 py-4">
                  <div className="flex flex-col gap-3 md:flex-row md:justify-between">
                    <div className="min-w-0 space-y-1.5">
                      <div className="font-medium">
                        {s.tripMember.user.name} · {s.requirement.title}
                      </div>
                      <div className="text-xs text-ink-3">Submitted {formatDateTime(s.submittedAt, t.org.timezone)}</div>
                      {s.document && (
                        <a href={`/api/files/${s.document.id}`} className="text-sm text-accent underline">
                          Open {s.document.filename}
                        </a>
                      )}
                      {fields.length > 0 && (
                        <dl className="space-y-1 text-sm">
                          {fields.map((f) => (
                            <div key={f.key}>
                              <dt className="text-ink-3">{f.label}</dt>
                              <dd className="whitespace-pre-line">{answers[f.key] || "—"}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-2 md:w-72">
                      <ActionButton action={reviewSubmissionAction.bind(null, slug, t.trip.id, s.id, "APPROVED")} variant="primary">
                        Approve
                      </ActionButton>
                      <details>
                        <summary className="cursor-pointer text-sm text-ink-2">Request changes…</summary>
                        <ActionForm action={reviewSubmissionAction.bind(null, slug, t.trip.id, s.id, "CHANGES_REQUESTED")} className="mt-2 space-y-2">
                          <TextArea label="What needs to change?" name="note" rows={2} required />
                          <SubmitButton variant="secondary">Send back</SubmitButton>
                        </ActionForm>
                      </details>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Readiness" description="Each approved participant against each requirement." />
        {requirements.length === 0 || rows.length === 0 ? (
          <EmptyState title={requirements.length === 0 ? "No requirements yet" : "No approved participants yet"}>
            {requirements.length === 0 ? "Add documents, waivers, forms and tasks below." : "Approved participants will appear here."}
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Participant</Th>
                {requirements.map((r) => (
                  <Th key={r.id} className="max-w-36 truncate normal-case">
                    <span title={r.title}>{r.title}</span>
                    {!r.isRequired && <span className="text-ink-3"> (optional)</span>}
                  </Th>
                ))}
                <Th className="text-right">Ready</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.member.id}>
                  <Td className="font-medium whitespace-nowrap">{row.member.user.name}</Td>
                  {row.cells.map((c) => (
                    <Td key={c.requirement.id}>
                      <Badge tone={submissionStatusTone[c.state]}>{submissionStatusLabel[c.state]}</Badge>
                    </Td>
                  ))}
                  <Td className="text-right tabular-nums">
                    <Badge tone={row.percent === 100 ? "good" : "warn"}>{row.percent}%</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Requirements" />
          {requirements.length === 0 ? (
            <EmptyState title="None yet" />
          ) : (
            <ul className="divide-y divide-line">
              {requirements.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="font-medium">{r.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                      <Badge>{requirementKindLabel[r.kind]}</Badge>
                      {r.isRequired ? <Badge tone="accent">Required</Badge> : <Badge>Optional</Badge>}
                      {r.needsReview && <span>Reviewed by a leader</span>}
                      {r.dueDate && <span>· due {formatDate(r.dueDate)}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <ActionButton action={setRequirementRequiredAction.bind(null, slug, t.trip.id, r.id, !r.isRequired)} variant="ghost">
                      {r.isRequired ? "Make optional" : "Make required"}
                    </ActionButton>
                    <ActionButton action={deleteRequirementAction.bind(null, slug, t.trip.id, r.id)} variant="ghost" confirm={`Delete "${r.title}"?`}>
                      Delete
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Add a requirement" description="Approved participants are notified right away." />
          <CardBody>
            <RequirementForm action={createRequirementAction.bind(null, slug, t.trip.id)} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
