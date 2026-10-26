import { notFound } from "next/navigation";
import { pageOrg } from "@/server/page-guard";
import { getProfile } from "@/server/services/profiles";
import { AppError } from "@/server/errors";
import { db } from "@/server/db";
import { Alert, Badge, Card, CardBody, CardHeader, DescriptionList, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { memberStatusLabel, memberStatusTone } from "@/lib/labels";

export const metadata = { title: "Person" };

export default async function PersonPage({ params }: { params: Promise<{ org: string; userId: string }> }) {
  const { org, userId } = await params;
  const ctx = await pageOrg(org);
  let data;
  try {
    data = await getProfile(ctx, userId); // checks permission and records the view
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const { user, profile, sensitive } = data;
  const trips = await db.tripMember.findMany({ where: { orgId: ctx.org.id, userId }, include: { trip: { select: { name: true } } } });

  return (
    <div className="max-w-3xl">
      <PageHeader title={user.name} description={user.email} />
      {userId !== ctx.user.id && (
        <div className="mb-6">
          <Alert tone="info">This is private information. Your viewing of this page is recorded in the church&apos;s activity log.</Alert>
        </div>
      )}
      <div className="space-y-6">
        <Card>
          <CardHeader title="Trips" />
          <ul className="divide-y divide-line">
            {trips.length === 0 && <li className="px-5 py-3 text-sm text-ink-3">Not on any trips.</li>}
            {trips.map((tm) => (
              <li key={tm.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span>{tm.trip.name}</span>
                <span className="flex gap-1.5">
                  {tm.role === "LEADER" && <Badge tone="accent">Leader</Badge>}
                  <Badge tone={memberStatusTone[tm.status]}>{memberStatusLabel[tm.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Contact & emergency" />
          <CardBody>
            {!profile ? (
              <p className="text-sm text-ink-3">{user.name} hasn&apos;t filled in their profile yet.</p>
            ) : (
              <DescriptionList
                items={[
                  { label: "Phone", value: profile.phone ?? "—" },
                  { label: "Date of birth", value: formatDate(profile.dateOfBirth) },
                  { label: "Emergency contact", value: profile.emergencyContactName ? `${profile.emergencyContactName}${profile.emergencyContactRelation ? ` (${profile.emergencyContactRelation})` : ""}` : "—" },
                  { label: "Emergency phone", value: profile.emergencyContactPhone ?? "—" },
                ]}
              />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Health" description="Encrypted at rest. Visible only to this person, their trip leaders, and church administrators." />
          <CardBody>
            <DescriptionList
              items={[
                { label: "Allergies", value: sensitive.allergies || "—" },
                { label: "Medications", value: sensitive.medications || "—" },
                { label: "Medical notes", value: <span className="whitespace-pre-line">{sensitive.medicalNotes || "—"}</span> },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
