import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { ActionButton } from "@/components/forms";
import { requireUser } from "@/server/context";
import { db } from "@/server/db";
import { formatDateTime } from "@/lib/dates";
import { markAllReadAction } from "../account/actions";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const unread = items.some((i) => !i.readAt);
  return (
    <>
      <TopBar user={user} />
      <main id="main" className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <PageHeader title="Notifications" actions={unread ? <ActionButton action={markAllReadAction}>Mark all as read</ActionButton> : undefined} />
        <Card>
          {items.length === 0 ? (
            <EmptyState title="You're all caught up" />
          ) : (
            <ul className="divide-y divide-line">
              {items.map((n) => {
                const body = (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <span className={cx("font-medium", !n.readAt && "text-ink")}>
                        {!n.readAt && <span aria-label="Unread" className="mr-2 inline-block size-2 rounded-full bg-accent align-middle" />}
                        {n.title}
                      </span>
                      <span className="shrink-0 text-xs text-ink-3">{formatDateTime(n.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-ink-2">{n.body}</p>
                  </>
                );
                return (
                  <li key={n.id} className={cx(!n.readAt && "bg-accent-soft/40")}>
                    {n.href ? (
                      <Link href={n.href} className="block px-5 py-3 min-h-11 transition-colors hover:bg-subtle active:bg-subtle">
                        {body}
                      </Link>
                    ) : (
                      <div className="px-5 py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}
