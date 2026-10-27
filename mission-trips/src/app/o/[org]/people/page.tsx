import Link from "next/link";
import { pageOrgAdmin } from "@/server/page-guard";
import { db } from "@/server/db";
import { Avatar, Badge, Card, CardBody, CardHeader, PageHeader, Table, Td, Th } from "@/components/ui";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextField } from "@/components/forms";
import { formatDate } from "@/lib/dates";
import { inviteAction, removeMemberAction, revokeInviteAction, setRoleAction } from "../actions";

export const metadata = { title: "People" };

export default async function PeoplePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await pageOrgAdmin(org);
  const [members, invitations] = await Promise.all([
    db.membership.findMany({
      where: { orgId: ctx.org.id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            tripMembers: { where: { orgId: ctx.org.id, status: { in: ["APPROVED", "APPLIED", "WAITLISTED"] } }, select: { role: true, trip: { select: { name: true } } } },
          },
        },
      },
      orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
    }),
    db.invitation.findMany({
      where: { orgId: ctx.org.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { trip: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <>
      <PageHeader title="People" description="Everyone with access to your church's workspace. Donors who aren't members don't appear here." />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={`Members (${members.length})`} />
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Trips</Th>
                <Th>Role</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={m.user.name} />
                      <div className="min-w-0">
                        <Link href={`/o/${ctx.org.slug}/people/${m.userId}`} className="font-medium hover:underline">
                          {m.user.name}
                        </Link>
                        <div className="truncate text-xs text-ink-3">{m.user.email}</div>
                      </div>
                    </div>
                  </Td>
                  <Td label="Trips" className="text-sm text-ink-2">
                    {m.user.tripMembers.length === 0
                      ? "—"
                      : m.user.tripMembers.map((tm) => `${tm.trip.name}${tm.role === "LEADER" ? " (leader)" : ""}`).join(", ")}
                  </Td>
                  <Td label="Role">{m.role === "ADMIN" ? <Badge tone="accent">Admin</Badge> : <Badge>Member</Badge>}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {m.userId !== ctx.user.id && (
                      <>
                        <ActionButton action={setRoleAction.bind(null, ctx.org.slug, m.id, m.role === "ADMIN" ? "MEMBER" : "ADMIN")} variant="ghost" confirm={m.role === "ADMIN" ? `Remove admin access for ${m.user.name}?` : `Make ${m.user.name} a church administrator? Admins can see all finances and private records.`}>
                          {m.role === "ADMIN" ? "Make member" : "Make admin"}
                        </ActionButton>
                        <ActionButton action={removeMemberAction.bind(null, ctx.org.slug, m.id)} variant="ghost" confirm={`Remove ${m.user.name} from ${ctx.org.name}? They'll lose access to all trips.`}>
                          Remove
                        </ActionButton>
                      </>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Invite someone" description="To invite someone onto a specific trip, use that trip's Team page." />
            <CardBody>
              <ActionForm action={inviteAction.bind(null, ctx.org.slug)} resetOnSuccess className="space-y-4">
                <TextField label="Email" name="email" type="email" required />
                <SelectField
                  label="Access"
                  name="orgRole"
                  options={[
                    { value: "MEMBER", label: "Member" },
                    { value: "ADMIN", label: "Church administrator" },
                  ]}
                  hint="Administrators can manage every trip, see all finances, and see private participant records."
                />
                <SubmitButton pendingText="Sending…">Send invitation</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
          {invitations.length > 0 && (
            <Card>
              <CardHeader title="Pending invitations" />
              <ul className="divide-y divide-line">
                {invitations.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{i.email}</span>
                      <span className="text-xs text-ink-3">
                        {i.trip ? `${i.trip.name} · ${i.tripRole === "LEADER" ? "leader" : "participant"}` : i.orgRole === "ADMIN" ? "Administrator" : "Member"} · expires {formatDate(i.expiresAt)}
                      </span>
                    </span>
                    <ActionButton action={revokeInviteAction.bind(null, ctx.org.slug, i.id)} variant="ghost">
                      Revoke
                    </ActionButton>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
