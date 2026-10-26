import { notFound } from "next/navigation";
import { TopBar } from "@/components/top-bar";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { requireUser } from "@/server/context";
import { listOrganizations, operationsHealth } from "@/server/services/platform";
import { stripeConfigured } from "@/server/payments/gateway";
import { env } from "@/server/env";
import { formatDate, formatDateTime } from "@/lib/dates";
import { setOrgStatusAction } from "../account/actions";

export const metadata = { title: "Platform admin" };

// Platform operators approve and suspend churches and watch system health.
// They do not get access to any church's private records from here.
export default async function AdminPage() {
  const user = await requireUser();
  if (user.platformRole !== "PLATFORM_ADMIN") notFound();
  const [orgs, health] = await Promise.all([listOrganizations(user), operationsHealth(user)]);
  const e = env();

  return (
    <>
      <TopBar user={user} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <PageHeader title="Platform admin" description={`Environment: ${e.APP_ENV} · Stripe ${stripeConfigured() ? `configured (${e.STRIPE_MODE} mode)` : "not configured"} · Email: ${e.EMAIL_TRANSPORT}`} />
        <Card className="mb-6">
          <CardBody className="grid grid-cols-2 gap-6 md:grid-cols-4">
            <Stat label="Churches" value={orgs.length} sub={`${orgs.filter((o) => o.status === "PENDING_REVIEW").length} awaiting review`} />
            <Stat label="Unprocessed Stripe events" value={health.unprocessedEvents} tone={health.unprocessedEvents ? "warn" : undefined} />
            <Stat label="Emails queued / failed" value={`${health.queuedEmails} / ${health.failedEmails}`} tone={health.failedEmails ? "bad" : undefined} />
            <Stat label="Payments stuck > 24h" value={health.stalePending} tone={health.stalePending ? "warn" : undefined} />
          </CardBody>
        </Card>
        {health.failedEvents.length > 0 && (
          <Card className="mb-6">
            <CardHeader title="Stripe events that failed to process" description="Stripe retries these automatically for up to 3 days. Persistent failures need investigation." />
            <Table>
              <thead>
                <tr>
                  <Th>Event</Th>
                  <Th>Received</Th>
                  <Th>Attempts</Th>
                  <Th>Error</Th>
                </tr>
              </thead>
              <tbody>
                {health.failedEvents.map((ev) => (
                  <tr key={ev.id}>
                    <Td className="font-mono text-xs">
                      {ev.type}
                      <div className="text-ink-3">{ev.id}</div>
                    </Td>
                    <Td className="whitespace-nowrap">{formatDateTime(ev.receivedAt)}</Td>
                    <Td>{ev.attempts}</Td>
                    <Td className="max-w-96 truncate text-xs text-bad">{ev.lastError}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
        <Card>
          <CardHeader title="Churches" />
          {orgs.length === 0 ? (
            <CardBody>
              <Alert tone="info">No churches have signed up yet.</Alert>
            </CardBody>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Church</Th>
                  <Th>Created</Th>
                  <Th className="text-right">Members / trips</Th>
                  <Th>Payments</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id}>
                    <Td>
                      <div className="font-medium">{o.name}</div>
                      <div className="text-xs text-ink-3">
                        /{o.slug} · {o.contactEmail}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDate(o.createdAt)}</Td>
                    <Td className="text-right tabular-nums">
                      {o._count.memberships} / {o._count.trips}
                    </Td>
                    <Td>{o.stripeChargesEnabled ? <Badge tone="good">Connected</Badge> : o.stripeAccountId ? <Badge tone="warn">Setup unfinished</Badge> : <Badge>Not connected</Badge>}</Td>
                    <Td>
                      <Badge tone={o.status === "ACTIVE" ? "good" : o.status === "SUSPENDED" ? "bad" : "warn"}>{o.status === "PENDING_REVIEW" ? "Pending review" : o.status === "ACTIVE" ? "Active" : "Suspended"}</Badge>
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {o.status !== "ACTIVE" && (
                        <ActionButton action={setOrgStatusAction.bind(null, o.id, "ACTIVE")} variant="primary" confirm={`Approve ${o.name}? Their public giving pages can go live.`}>
                          {o.status === "SUSPENDED" ? "Reinstate" : "Approve"}
                        </ActionButton>
                      )}
                      {o.status !== "SUSPENDED" && (
                        <ActionButton action={setOrgStatusAction.bind(null, o.id, "SUSPENDED")} variant="ghost" confirm={`Suspend ${o.name}? Members lose access and giving stops.`}>
                          Suspend
                        </ActionButton>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </main>
    </>
  );
}
