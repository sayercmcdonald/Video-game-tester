import { notFound } from "next/navigation";
import { pageTrip } from "@/server/page-guard";
import { tripPosts } from "@/server/services/posts";
import { db } from "@/server/db";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import { ActionButton, ActionForm, SelectField, SubmitButton, TextArea, TextField } from "@/components/forms";
import { formatDateTime } from "@/lib/dates";
import { approvePostAction, createPostAction, deletePostAction } from "../actions";

export const metadata = { title: "Updates" };

export default async function UpdatesPage({ params }: { params: Promise<{ org: string; tripId: string }> }) {
  const { org, tripId } = await params;
  const t = await pageTrip(org, tripId);
  if (!t.perms.viewTeam) notFound();
  const posts = await tripPosts(t);
  const authors = await db.user.findMany({ where: { id: { in: [...new Set(posts.map((p) => p.authorId))] } }, select: { id: true, name: true } });
  const nameOf = (id: string) => authors.find((a) => a.id === id)?.name ?? "Former member";

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {posts.length === 0 ? (
          <Card>
            <EmptyState title="No updates yet">{t.perms.manage ? "Post team announcements, or updates for donors on the public trip page." : "Announcements from your leaders will appear here."}</EmptyState>
          </Card>
        ) : (
          posts.map((p) => (
            <Card key={p.id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="font-semibold">{p.title}</h2>
                  <div className="flex gap-1.5">
                    <Badge tone={p.audience === "PUBLIC" ? "info" : "neutral"}>{p.audience === "PUBLIC" ? "Donors & public" : "Team only"}</Badge>
                    {p.status === "PENDING_APPROVAL" && <Badge tone="warn">Awaiting approval</Badge>}
                  </div>
                </div>
                <div className="mt-0.5 text-xs text-ink-3">
                  {nameOf(p.authorId)} · {formatDateTime(p.publishedAt ?? p.createdAt, t.org.timezone)}
                </div>
                <p className="mt-3 whitespace-pre-line text-ink-2">{p.body}</p>
                {t.perms.manage && (
                  <div className="mt-4 flex gap-2">
                    {p.status === "PENDING_APPROVAL" && t.perms.publishPublicUpdates && (
                      <ActionButton action={approvePostAction.bind(null, t.org.slug, t.trip.id, p.id)} variant="primary">
                        Approve &amp; publish
                      </ActionButton>
                    )}
                    {(t.perms.isOrgAdmin || p.authorId === t.user.id) && (
                      <ActionButton action={deletePostAction.bind(null, t.org.slug, t.trip.id, p.id)} variant="ghost" confirm="Delete this update?">
                        Delete
                      </ActionButton>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          ))
        )}
      </div>
      {t.perms.manage && (
        <Card className="self-start">
          <CardHeader title="Post an update" />
          <CardBody>
            <ActionForm action={createPostAction.bind(null, t.org.slug, t.trip.id)} resetOnSuccess className="space-y-3">
              <SelectField
                label="Who sees it"
                name="audience"
                options={[
                  { value: "TEAM", label: "Team only (leaders & participants)" },
                  { value: "PUBLIC", label: "Donors & public trip page" },
                ]}
                hint={t.perms.publishPublicUpdates ? "Team updates email the team right away." : "Public updates are reviewed by a church admin before donors see them."}
              />
              <TextField label="Title" name="title" required />
              <TextArea label="Message" name="body" rows={6} hint="For public updates, don't share participants' private details, locations of minors, or photos without consent." required />
              <SubmitButton>Post</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
