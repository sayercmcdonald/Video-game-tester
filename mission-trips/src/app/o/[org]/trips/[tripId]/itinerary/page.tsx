import { notFound } from "next/navigation";
import { pageTrip } from "@/server/page-guard";
import { db } from "@/server/db";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextArea, TextField } from "@/components/forms";
import { itineraryKindLabel } from "@/lib/labels";
import { addItineraryAction, deleteItineraryAction } from "../../../actions";

export const metadata = { title: "Itinerary" };

// Itinerary times are local trip times, stored as wall-clock values, so display in UTC.
const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });

export default async function ItineraryPage({ params }: { params: Promise<{ org: string; tripId: string }> }) {
  const { org, tripId } = await params;
  const t = await pageTrip(org, tripId);
  if (!t.perms.viewTeam) notFound();
  const items = await db.itineraryItem.findMany({ where: { tripId: t.trip.id, orgId: t.org.id }, orderBy: { startsAt: "asc" } });
  const days = new Map<string, typeof items>();
  for (const i of items) {
    const key = i.startsAt.toISOString().slice(0, 10);
    days.set(key, [...(days.get(key) ?? []), i]);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {items.length === 0 ? (
          <Card>
            <EmptyState title="No itinerary yet">{t.perms.manage ? "Add meetings, flights, lodging and activities. Times are local to where each happens." : "Your leaders will post the schedule here."}</EmptyState>
          </Card>
        ) : (
          [...days.entries()].map(([day, list]) => (
            <Card key={day}>
              <CardHeader title={dayFmt.format(new Date(`${day}T00:00:00Z`))} />
              <ul className="divide-y divide-line">
                {list.map((i) => (
                  <li key={i.id} className="flex gap-4 px-5 py-3">
                    <div className="w-20 shrink-0 text-sm text-ink-2 tabular-nums">
                      {timeFmt.format(i.startsAt)}
                      {i.endsAt && <div className="text-xs text-ink-3">to {timeFmt.format(i.endsAt)}</div>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{i.title}</span>
                        <Badge>{itineraryKindLabel[i.kind]}</Badge>
                      </div>
                      {i.location && <div className="text-sm text-ink-2">{i.location}</div>}
                      {i.notes && <p className="mt-1 text-sm whitespace-pre-line text-ink-3">{i.notes}</p>}
                    </div>
                    {t.perms.manage && (
                      <ActionButton action={deleteItineraryAction.bind(null, t.org.slug, t.trip.id, i.id)} variant="ghost" confirm={`Remove "${i.title}"?`}>
                        Remove
                      </ActionButton>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))
        )}
      </div>
      {t.perms.manage && (
        <Card className="self-start">
          <CardHeader title="Add to itinerary" />
          <CardBody>
            <ActionForm action={addItineraryAction.bind(null, t.org.slug, t.trip.id)} resetOnSuccess className="space-y-3">
              <SelectField label="Type" name="kind" options={Object.entries(itineraryKindLabel).map(([value, label]) => ({ value, label }))} defaultValue="ACTIVITY" />
              <TextField label="Title" name="title" required />
              <TextField label="Starts" name="startsAt" type="datetime-local" hint="Local time where it happens." required />
              <TextField label="Ends" name="endsAt" type="datetime-local" optional />
              <TextField label="Location" name="location" optional />
              <TextArea label="Notes" name="notes" rows={2} optional />
              <SubmitButton>Add</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
