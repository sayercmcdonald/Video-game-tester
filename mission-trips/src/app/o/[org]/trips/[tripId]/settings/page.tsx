import { notFound } from "next/navigation";
import { pageTrip } from "@/server/page-guard";
import { Card, PageHeader } from "@/components/ui";
import { TripForm } from "@/components/trip-form";
import { centsToInput } from "@/lib/money";
import { toDateInput } from "@/lib/dates";
import { updateTripAction } from "../../../actions";

export const metadata = { title: "Trip settings" };

export default async function TripSettingsPage({ params }: { params: Promise<{ org: string; tripId: string }> }) {
  const { org, tripId } = await params;
  const t = await pageTrip(org, tripId);
  if (!t.perms.manage) notFound();
  const trip = t.trip;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Trip settings" />
      <Card className="p-6">
        <TripForm
          action={updateTripAction.bind(null, t.org.slug, trip.id)}
          submitLabel="Save changes"
          showFinanceToggle={t.perms.isOrgAdmin}
          defaults={{
            name: trip.name,
            destination: trip.destination,
            summary: trip.summary,
            startDate: toDateInput(trip.startDate),
            endDate: toDateInput(trip.endDate),
            budget: centsToInput(trip.budgetCents),
            fundraisingGoal: centsToInput(trip.fundraisingGoalCents),
            defaultParticipantGoal: centsToInput(trip.defaultParticipantGoalCents),
            participantLimit: trip.participantLimit?.toString(),
            applicationsOpen: trip.applicationsOpen,
            leadersSeeFinances: trip.leadersSeeFinances,
          }}
        />
      </Card>
    </div>
  );
}
