import Link from "next/link";
import { pageOrgAdmin } from "@/server/page-guard";
import { db } from "@/server/db";
import { PROVIDERS, type IntegrationAvailability } from "@/server/integrations/registry";
import { Badge, Card, CardBody, CardHeader, PageHeader, Table, Td, Th, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";

export const metadata = { title: "Integrations" };

const availabilityBadge: Record<IntegrationAvailability, { label: string; tone: "good" | "info" | "neutral" | "warn" }> = {
  available: { label: "Available", tone: "good" },
  planned: { label: "Planned", tone: "info" },
  partner_access: { label: "Needs partner access", tone: "warn" },
  not_planned: { label: "Not planned", tone: "neutral" },
};

const exportsList = [
  { kind: "donations", title: "Gifts", body: "Every received gift with receipt number, donor, amount, refunds, fees, method and designation." },
  { kind: "expenses", title: "Expenses", body: "Every expense with category, vendor, status, who submitted it and who approved it." },
  { kind: "ledger", title: "Ledger", body: "Every money movement for reconciliation: gifts, fees, refunds, chargebacks and expenses." },
];

export default async function IntegrationsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await pageOrgAdmin(org);
  const [trips, runs] = await Promise.all([
    db.trip.findMany({ where: { orgId: ctx.org.id }, orderBy: { startDate: "desc" }, select: { id: true, name: true } }),
    db.syncRun.findMany({ where: { orgId: ctx.org.id }, orderBy: { startedAt: "desc" }, take: 10 }),
  ]);
  const people = await db.user.findMany({ where: { id: { in: runs.map((r) => r.triggeredById).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const base = `/api/orgs/${ctx.org.slug}/export`;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Integrations" description="Sent works alongside the church software you already use. Here's what connects today, and what's coming." />

      <Card>
        <CardHeader title="Export for your bookkeeper" description="Spreadsheet files (CSV) that open in Excel and import into most accounting and church management systems. Downloads are recorded in the activity log." />
        <ul className="divide-y divide-line">
          {exportsList.map((x) => (
            <li key={x.kind} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="min-w-0">
                <div className="font-medium">{x.title}</div>
                <div className="text-[15px] text-ink-2 lg:text-sm">{x.body}</div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <a href={`${base}/${x.kind}`} className={buttonClass("secondary")} download>
                  All trips
                </a>
                {trips.length > 0 && (
                  <details className="relative">
                    <summary className={buttonClass("ghost", "list-none cursor-pointer")}>One trip</summary>
                    <div className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-2xl bg-surface shadow-[0_12px_40px_rgb(0_0_0/0.18)] ring-1 ring-line">
                      {trips.map((t) => (
                        <a key={t.id} href={`${base}/${x.kind}?trip=${t.id}`} download className="block min-h-11 px-4 py-2.5 hover:bg-subtle">
                          {t.name}
                        </a>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Connections" description="We only show a connection as available once it works and has been tested against the real service." />
        <ul className="divide-y divide-line">
          {PROVIDERS.filter((p) => p.provider !== "CSV_EXPORT").map((p) => {
            const b = availabilityBadge[p.availability];
            return (
              <li key={p.provider} className="px-4 py-3 sm:px-5">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{p.name}</span>
                  <Badge tone={b.tone}>{b.label}</Badge>
                </div>
                <p className="mt-0.5 text-[15px] text-ink-2 lg:text-sm">{p.summary}</p>
                <p className="mt-1 text-[13px] text-ink-3">{p.notes}</p>
                {p.docsUrl && (
                  <a href={p.docsUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[13px] text-accent hover:underline">
                    Provider documentation
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Recent exports and syncs" />
        {runs.length === 0 ? (
          <CardBody className="text-[15px] text-ink-3">Nothing yet.</CardBody>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>What</Th>
                <Th>Rows</Th>
                <Th>Status</Th>
                <Th>By</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <Td>{formatDateTime(r.startedAt, ctx.org.timezone)}</Td>
                  <Td label="What" className="capitalize">
                    {r.kind} {r.direction === "EXPORT" ? "export" : "import"}
                  </Td>
                  <Td label="Rows" className="tabular-nums">
                    {r.recordsTotal}
                  </Td>
                  <Td label="Status">
                    <Badge tone={r.status === "SUCCEEDED" ? "good" : r.status === "FAILED" ? "bad" : "warn"}>{r.status === "SUCCEEDED" ? "Done" : r.status === "FAILED" ? "Failed" : r.status === "RUNNING" ? "Running" : "Partly done"}</Badge>
                  </Td>
                  <Td label="By">{people.find((p) => p.id === r.triggeredById)?.name ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="text-[13px] text-ink-3">
        Questions about connecting another system? See <Link href={`/o/${ctx.org.slug}/settings`} className="underline">Settings</Link> or contact the Sent team.
      </p>
    </div>
  );
}
