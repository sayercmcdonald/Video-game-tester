import Link from "next/link";
import { pageOrgAdmin } from "@/server/page-guard";
import { db } from "@/server/db";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Activity log" };

const PAGE = 100;

function describe(action: string) {
  return action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export default async function AuditPage({ params, searchParams }: { params: Promise<{ org: string }>; searchParams: Promise<{ before?: string }> }) {
  const { org } = await params;
  const { before } = await searchParams;
  const ctx = await pageOrgAdmin(org);
  const beforeDate = before ? new Date(before) : null;
  const logs = await db.auditLog.findMany({
    where: { orgId: ctx.org.id, ...(beforeDate && !Number.isNaN(beforeDate.getTime()) ? { createdAt: { lt: beforeDate } } : {}) },
    orderBy: { createdAt: "desc" },
    take: PAGE,
  });
  const actors = await db.user.findMany({ where: { id: { in: [...new Set(logs.map((l) => l.actorUserId).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
  const who = (id: string | null) => (id ? (actors.find((a) => a.id === id)?.name ?? "Former member") : "System (payment processor)");

  return (
    <>
      <PageHeader title="Activity log" description="A permanent record of changes, money movements and views of private information. Entries can't be edited or deleted." />
      <Card>
        {logs.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>What</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <Td className="whitespace-nowrap text-ink-2">{formatDateTime(l.createdAt, ctx.org.timezone)}</Td>
                  <Td label="Who" className="whitespace-nowrap">{who(l.actorUserId)}</Td>
                  <Td label="What">{describe(l.action)}</Td>
                  <Td label="Details" className="max-w-80 truncate font-mono text-xs text-ink-3">{l.metadata ? JSON.stringify(l.metadata) : `${l.entityType} ${l.entityId.slice(-8)}`}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {logs.length === PAGE && (
        <div className="mt-4">
          <Link href={`?before=${encodeURIComponent(logs[logs.length - 1].createdAt.toISOString())}`} className="text-sm text-accent hover:underline">
            Older entries →
          </Link>
        </div>
      )}
    </>
  );
}
