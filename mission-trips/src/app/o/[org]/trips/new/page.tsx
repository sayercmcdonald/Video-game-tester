import { pageOrgAdmin } from "@/server/page-guard";
import { Card, PageHeader } from "@/components/ui";
import { TripForm } from "@/components/trip-form";
import { createTripAction } from "../../actions";

export const metadata = { title: "New trip" };

export default async function NewTripPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await pageOrgAdmin(org);
  return (
    <div className="max-w-3xl">
      <PageHeader title="New trip" description="Trips start as drafts, visible only to admins and leaders, until you open them." />
      <Card className="p-6">
        <TripForm action={createTripAction.bind(null, ctx.org.slug)} submitLabel="Create trip" defaults={{ applicationsOpen: true }} />
      </Card>
    </div>
  );
}
