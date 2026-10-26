import Link from "next/link";
import { notFound } from "next/navigation";
import { pageTrip } from "@/server/page-guard";
import { db } from "@/server/db";
import { participantFundraising } from "@/server/services/finance";
import { tripReadiness } from "@/server/services/requirements";
import { Avatar, Badge, Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField } from "@/components/forms";
import { formatMoney, percent } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { memberStatusLabel, memberStatusTone } from "@/lib/labels";
import { addLeaderAction, decideApplicationAction, inviteAction, removeFromTripAction } from "../../../actions";

export const metadata = { title: "Team" };

export default async function TeamPage({ params }: { params: Promise<{ org: string; tripId: string }> }) {
  const { org, tripId } = await params;
  const t = await pageTrip(org, tripId);
  if (!t.perms.viewTeam) notFound();
  const slug = t.org.slug;

  const members = await db.tripMember.findMany({
    where: { tripId: t.trip.id },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
  });
  const leaders = members.filter((m) => m.role === "LEADER" && m.status === "APPROVED");
  const participants = members.filter((m) => m.role === "PARTICIPANT" && m.status === "APPROVED");
  const pending = members.filter((m) => ["APPLIED", "WAITLISTED"].includes(m.status));

  if (!t.perms.manage) {
    return (
      <Card>
        <CardHeader title="Your team" description={`${participants.length} participants · ${leaders.length} leaders`} />
        <ul className="divide-y divide-line">
          {[...leaders, ...participants].map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-5 py-3">
              <Avatar name={m.user.name} />
              <span className="font-medium">{m.user.name}</span>
              {m.role === "LEADER" && <Badge tone="accent">Leader</Badge>}
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  const [fundraising, readiness, invitations, orgMembers] = await Promise.all([
    participantFundraising(t.trip.id, t.org.id),
    tripReadiness(t.trip.id, t.org.id),
    db.invitation.findMany({ where: { tripId: t.trip.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    t.perms.isOrgAdmin ? db.membership.findMany({ where: { orgId: t.org.id }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { user: { name: "asc" } } }) : Promise.resolve([]),
  ]);
  const leaderCandidates = orgMembers.filter((m) => !leaders.some((l) => l.userId === m.userId));

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <Card>
          <CardHeader title="Applications" description="Approving someone creates their fundraising page and adds them to team updates." />
          <ul className="divide-y divide-line">
            {pending.map((m) => (
              <li key={m.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/o/${slug}/people/${m.userId}`} className="font-medium hover:underline">
                      {m.user.name}
                    </Link>
                    <Badge tone={memberStatusTone[m.status]}>{memberStatusLabel[m.status]}</Badge>
                  </div>
                  <div className="text-sm text-ink-3">
                    {m.user.email} · applied {formatDate(m.createdAt)}
                  </div>
                  {m.applicationNote && <p className="mt-2 text-sm whitespace-pre-line text-ink-2">“{m.applicationNote}”</p>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <ActionButton action={decideApplicationAction.bind(null, slug, t.trip.id, m.id, "APPROVED")} variant="primary">
                    Approve
                  </ActionButton>
                  {m.status !== "WAITLISTED" && (
                    <ActionButton action={decideApplicationAction.bind(null, slug, t.trip.id, m.id, "WAITLISTED")}>Waitlist</ActionButton>
                  )}
                  <ActionButton action={decideApplicationAction.bind(null, slug, t.trip.id, m.id, "DECLINED")} variant="danger" confirm={`Decline ${m.user.name}'s application?`}>
                    Decline
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Participants" description={`${participants.length}${t.trip.participantLimit ? ` of ${t.trip.participantLimit}` : ""} approved`} />
        {participants.length === 0 ? (
          <EmptyState title="No participants yet">Invite people below, or open applications in the trip settings.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th className="text-right">Raised</Th>
                <Th className="text-right">Requirements</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {participants.map((m) => {
                const f = fundraising.find((x) => x.userId === m.userId);
                const r = readiness.rows.find((x) => x.member.id === m.id);
                return (
                  <tr key={m.id}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={m.user.name} />
                        <div className="min-w-0">
                          <Link href={`/o/${slug}/people/${m.userId}`} className="font-medium hover:underline">
                            {m.user.name}
                          </Link>
                          <div className="truncate text-xs text-ink-3">{m.user.email}</div>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">
                      {f ? (
                        <>
                          {formatMoney(f.raisedCents, t.org.currency, { compact: true })}
                          <span className="text-ink-3"> / {formatMoney(f.goalCents, t.org.currency, { compact: true })}</span>
                          <div className="text-xs text-ink-3">{percent(f.raisedCents, f.goalCents)}%</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="text-right">
                      <Badge tone={r?.percent === 100 ? "good" : "warn"}>{r?.percent ?? 100}%</Badge>
                    </Td>
                    <Td className="text-right">
                      <ActionButton action={removeFromTripAction.bind(null, slug, t.trip.id, m.id)} variant="ghost" confirm={`Remove ${m.user.name} from this trip? Their gift history is kept.`}>
                        Remove
                      </ActionButton>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Leaders" />
          <ul className="divide-y divide-line">
            {leaders.length === 0 && <li className="px-5 py-4 text-sm text-ink-3">No leaders assigned yet.</li>}
            {leaders.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex items-center gap-2.5">
                  <Avatar name={m.user.name} />
                  <div>
                    <div className="font-medium">{m.user.name}</div>
                    <div className="text-xs text-ink-3">{m.user.email}</div>
                  </div>
                </div>
                {t.perms.isOrgAdmin && (
                  <ActionButton action={removeFromTripAction.bind(null, slug, t.trip.id, m.id)} variant="ghost" confirm={`Remove ${m.user.name} as a leader?`}>
                    Remove
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
          {t.perms.isOrgAdmin && leaderCandidates.length > 0 && (
            <CardBody className="border-t border-line">
              <ActionForm action={addLeaderAction.bind(null, slug, t.trip.id)} className="flex items-end gap-2">
                <SelectField
                  label="Add a church member as leader"
                  name="userId"
                  className="flex-1"
                  options={[{ value: "", label: "Choose a person…" }, ...leaderCandidates.map((m) => ({ value: m.userId, label: `${m.user.name} (${m.user.email})` }))]}
                />
                <SubmitButton variant="secondary">Add</SubmitButton>
              </ActionForm>
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Invite to this trip" description="They'll get an email link. New people create an account when they accept." />
          <CardBody>
            <ActionForm action={inviteAction.bind(null, slug)} resetOnSuccess className="space-y-4">
              <input type="hidden" name="tripId" value={t.trip.id} />
              <TextField label="Email" name="email" type="email" required />
              <SelectField
                label="Role"
                name="tripRole"
                options={[{ value: "PARTICIPANT", label: "Participant" }, ...(t.perms.isOrgAdmin ? [{ value: "LEADER", label: "Trip leader" }] : [])]}
              />
              <SubmitButton pendingText="Sending…">Send invitation</SubmitButton>
            </ActionForm>
            {invitations.length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <div className="mb-2 text-xs font-medium tracking-wide text-ink-3 uppercase">Pending invitations</div>
                <ul className="space-y-1.5 text-sm">
                  {invitations.map((i) => (
                    <li key={i.id} className="flex justify-between gap-2">
                      <span className="truncate">{i.email}</span>
                      <span className="shrink-0 text-ink-3">{i.tripRole === "LEADER" ? "Leader" : "Participant"} · expires {formatDate(i.expiresAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
