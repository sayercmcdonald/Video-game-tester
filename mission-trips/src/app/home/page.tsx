import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { Alert, Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { requireUser } from "@/server/context";
import { db } from "@/server/db";
import { formatDateRange } from "@/lib/dates";
import { resendVerificationAction } from "@/app/(auth)/actions";
import { tripStatusLabel, tripStatusTone, memberStatusLabel } from "@/lib/labels";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const user = await requireUser();
  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    include: { org: true },
    orderBy: { createdAt: "asc" },
  });
  const tripMembers = await db.tripMember.findMany({
    where: { userId: user.id, status: { notIn: ["DECLINED", "WITHDRAWN"] } },
    include: { trip: { include: { org: { select: { slug: true, name: true } } } } },
    orderBy: { trip: { startDate: "asc" } },
  });
  const visibleTrips = tripMembers.filter((tm) => tm.trip.status !== "DRAFT" || tm.role === "LEADER");

  return (
    <>
      <TopBar user={user} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} description="Your churches, trips and giving in one place." />

        {!user.emailVerifiedAt && (
          <div className="mb-6">
            <Alert tone="warn" title="Please confirm your email address">
              <ActionForm action={resendVerificationAction} className="mt-2" showMessages>
                <span>Check your inbox for a confirmation link. </span>
                <SubmitButton variant="secondary" className="mt-2 h-8" pendingText="Sending…">
                  Resend link
                </SubmitButton>
              </ActionForm>
            </Alert>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="My trips" />
            {visibleTrips.length === 0 ? (
              <EmptyState title="You're not on a trip yet">
                When a church invites you to a trip, or approves your application, it will appear here.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {visibleTrips.map((tm) => (
                  <li key={tm.id}>
                    <Link href={`/o/${tm.trip.org.slug}/trips/${tm.trip.id}`} className="flex items-center justify-between gap-4 px-5 py-4 min-h-11 transition-colors hover:bg-subtle active:bg-subtle">
                      <div className="min-w-0">
                        <div className="font-medium">{tm.trip.name}</div>
                        <div className="text-sm text-ink-3">
                          {tm.trip.org.name} · {tm.trip.destination} · {formatDateRange(tm.trip.startDate, tm.trip.endDate)}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <Badge tone={tm.role === "LEADER" ? "accent" : "neutral"}>{tm.role === "LEADER" ? "Leader" : "Participant"}</Badge>
                        {tm.status !== "APPROVED" ? <Badge tone="warn">{memberStatusLabel[tm.status]}</Badge> : <Badge tone={tripStatusTone[tm.trip.status]}>{tripStatusLabel[tm.trip.status]}</Badge>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader title="My churches" />
              {memberships.length === 0 ? (
                <EmptyState title="No church yet" action={<LinkButton href="/new-church">Set up a church</LinkButton>}>
                  Church staff can create a workspace. Participants join through an invitation.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-line">
                  {memberships.map((m) => (
                    <li key={m.id}>
                      <Link href={`/o/${m.org.slug}`} className="flex items-center justify-between px-5 py-3 min-h-11 transition-colors hover:bg-subtle active:bg-subtle">
                        <span className="font-medium">{m.org.name}</span>
                        {m.role === "ADMIN" && <Badge tone="accent">Admin</Badge>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {memberships.length > 0 && (
                <div className="border-t border-line px-5 py-3 text-sm">
                  <Link href="/new-church" className="text-accent hover:underline">
                    + Set up another church
                  </Link>
                </div>
              )}
            </Card>
            <Card>
              <CardHeader title="My giving" description="Gifts you've made and their receipts." action={<LinkButton href="/donor" variant="secondary">View</LinkButton>} />
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}
