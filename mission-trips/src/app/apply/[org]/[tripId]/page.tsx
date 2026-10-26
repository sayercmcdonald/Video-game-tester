import { notFound, redirect } from "next/navigation";
import { TopBar } from "@/components/top-bar";
import { ActionForm, SubmitButton, TextArea } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/context";
import { db } from "@/server/db";
import { formatDateRange } from "@/lib/dates";
import { applyAction } from "@/app/o/[org]/actions";

export const metadata = { title: "Apply" };

export default async function ApplyPage({ params }: { params: Promise<{ org: string; tripId: string }> }) {
  const { org, tripId } = await params;
  const user = await requireUser();
  const trip = await db.trip.findFirst({
    where: { id: tripId, org: { slug: org, status: { not: "SUSPENDED" } }, status: "OPEN", applicationsOpen: true },
    include: { org: { select: { name: true, slug: true } } },
  });
  if (!trip) notFound();
  const existing = await db.tripMember.findUnique({ where: { tripId_userId: { tripId, userId: user.id } } });
  if (existing && existing.status !== "WITHDRAWN") redirect(`/o/${org}/trips/${tripId}`);

  return (
    <>
      <TopBar user={user} />
      <main id="main" className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        <PageHeader eyebrow={trip.org.name} title={`Apply: ${trip.name}`} description={`${trip.destination} · ${formatDateRange(trip.startDate, trip.endDate)}`} />
        <Card className="space-y-4 p-6">
          {trip.summary && <p className="whitespace-pre-line text-ink-2">{trip.summary}</p>}
          <ActionForm action={applyAction.bind(null, trip.org.slug, trip.id)} className="space-y-4">
            <TextArea label="Why would you like to go?" name="note" rows={5} hint="Share a little about yourself for the trip leaders." optional />
            <p className="text-sm text-ink-3">
              Applying adds you to {trip.org.name}&apos;s workspace as a member. Leaders will see your name and email address.
            </p>
            <SubmitButton pendingText="Sending…">Submit application</SubmitButton>
          </ActionForm>
        </Card>
      </main>
    </>
  );
}
