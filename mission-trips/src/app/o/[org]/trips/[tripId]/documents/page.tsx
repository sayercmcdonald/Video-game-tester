import { notFound } from "next/navigation";
import { pageTrip } from "@/server/page-guard";
import { db } from "@/server/db";
import { allowedTypesDescription } from "@/server/storage";
import { Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui";
import { ActionButton, ActionForm, SubmitButton, TextField } from "@/components/forms";
import { formatDate } from "@/lib/dates";
import { deleteResourceAction, uploadResourceAction } from "../actions";

export const metadata = { title: "Documents" };

function size(bytes: number) {
  return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export default async function DocumentsPage({ params }: { params: Promise<{ org: string; tripId: string }> }) {
  const { org, tripId } = await params;
  const t = await pageTrip(org, tripId);
  if (!t.perms.viewTeam) notFound();
  const docs = await db.document.findMany({
    where: { tripId: t.trip.id, orgId: t.org.id, kind: { in: ["TRIP_RESOURCE", "REQUIREMENT_TEMPLATE"] } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Team documents" description="Packing lists, guides and forms shared with the whole team. Participants' personal files are kept with their requirements." />
        {docs.length === 0 ? (
          <EmptyState title="No shared documents yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>File</Th>
                <Th>Added</Th>
                <Th className="text-right">Size</Th>
                {t.perms.manage && <Th />}
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <Td>
                    <a href={`/api/files/${d.id}`} className="font-medium text-accent hover:underline">
                      {d.filename}
                    </a>
                    {d.kind === "REQUIREMENT_TEMPLATE" && <div className="text-xs text-ink-3">Blank form for a requirement</div>}
                  </Td>
                  <Td label="Added" className="text-ink-2">{formatDate(d.createdAt)}</Td>
                  <Td label="Size" className="text-right text-ink-2 tabular-nums">{size(d.sizeBytes)}</Td>
                  {t.perms.manage && (
                    <Td className="text-right">
                      {d.kind === "TRIP_RESOURCE" && (
                        <ActionButton action={deleteResourceAction.bind(null, t.org.slug, t.trip.id, d.id)} variant="ghost" confirm={`Delete ${d.filename}?`}>
                          Delete
                        </ActionButton>
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {t.perms.manage && (
        <Card className="self-start">
          <CardHeader title="Share a document" />
          <CardBody>
            <ActionForm action={uploadResourceAction.bind(null, t.org.slug, t.trip.id)} resetOnSuccess className="space-y-3">
              <TextField label="File" name="file" type="file" hint={allowedTypesDescription()} required />
              <SubmitButton pendingText="Uploading…">Upload</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
