import { notFound } from "next/navigation";
import { pageTrip } from "@/server/page-guard";
import { db } from "@/server/db";
import { financialSummary, EXPENSE_CATEGORIES } from "@/server/services/finance";
import { allowedTypesDescription } from "@/server/storage";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, Stat, Table, Td, Th } from "@/components/ui";
import { ActionForm, CheckboxField, MoneyField, SelectField, SubmitButton, TextArea, TextField } from "@/components/forms";
import { BulletChart } from "@/components/charts";
import { centsToInput, formatMoney } from "@/lib/money";
import { formatDate, formatDateTime, toDateInput } from "@/lib/dates";
import { expenseCategoryLabel, expenseStatusLabel } from "@/lib/labels";
import { attachReceiptAction, createExpenseAction, markExpensePaidAction, publishReportAction, setBudgetAction, voidExpenseAction } from "../actions";

export const metadata = { title: "Finances" };

const ledgerTypeLabel: Record<string, string> = {
  DONATION: "Gift received",
  PROCESSING_FEE: "Processing fee",
  REFUND: "Refund",
  DISPUTE: "Chargeback",
  DISPUTE_REVERSAL: "Chargeback reversed",
  EXPENSE: "Expense paid",
  EXPENSE_REVERSAL: "Expense voided",
  ADJUSTMENT: "Adjustment",
};

export default async function FinancesPage({ params }: { params: Promise<{ org: string; tripId: string }> }) {
  const { org, tripId } = await params;
  const t = await pageTrip(org, tripId);
  if (!t.perms.viewFinances) notFound();
  const cur = t.org.currency;
  const slug = t.org.slug;
  const [s, expenses, ledger, reports] = await Promise.all([
    financialSummary(t.trip.id, t.org.id),
    db.expense.findMany({ where: { tripId: t.trip.id, orgId: t.org.id }, orderBy: [{ incurredOn: "desc" }, { createdAt: "desc" }], include: { receipt: { select: { id: true, filename: true } } } }),
    db.ledgerEntry.findMany({ where: { tripId: t.trip.id, orgId: t.org.id }, orderBy: { createdAt: "desc" }, take: 25 }),
    db.financialReport.findMany({ where: { tripId: t.trip.id }, orderBy: { publishedAt: "desc" } }),
  ]);
  const budgetRows = s.categories
    .filter((c) => c.budgetCents > 0 || c.paidCents > 0 || c.committedCents > 0)
    .map((c) => ({ label: expenseCategoryLabel[c.category], primary: c.paidCents, secondary: c.committedCents, target: c.budgetCents }));
  const projected = s.totals.balance - s.committedCents;

  return (
    <div className="space-y-6">
      <Card>
        <CardBody className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Gifts received" value={formatMoney(s.totals.donations, cur)} sub={`${s.giftCount} gifts`} />
          <Stat label="Refunds & disputes" value={formatMoney(s.totals.refunds + s.totals.disputes, cur)} />
          <Stat label="Processing fees" value={formatMoney(s.totals.fees, cur)} />
          <Stat label="Spent" value={formatMoney(s.totals.expenses, cur)} sub={`${formatMoney(s.committedCents, cur)} more committed`} />
          <Stat label="Available now" value={formatMoney(s.totals.balance, cur)} tone={s.totals.balance < 0 ? "bad" : undefined} />
          <Stat label="After commitments" value={formatMoney(projected, cur)} tone={projected < 0 ? "bad" : undefined} sub={s.pledgesOpenCents ? `+${formatMoney(s.pledgesOpenCents, cur)} pledged` : undefined} />
        </CardBody>
        <div className="border-t border-line px-5 py-3 text-sm text-ink-3">
          Designated for this trip: <span className="text-ink tabular-nums">{formatMoney(s.restricted.restricted, cur)}</span> · Unrestricted:{" "}
          <span className="text-ink tabular-nums">{formatMoney(s.restricted.unrestricted, cur)}</span>
          {s.pendingGiftCount > 0 && <> · {s.pendingGiftCount} online gift(s) still processing (not counted)</>}
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Budget vs. actual" description={`Total budget ${formatMoney(s.budgetCents, cur)}`} />
          <CardBody>
            {budgetRows.length === 0 ? (
              <EmptyState title="No budget or expenses yet">Set a budget by category, then record expenses as they&apos;re booked and paid.</EmptyState>
            ) : (
              <BulletChart rows={budgetRows} primaryLabel="Paid" secondaryLabel="Committed" targetLabel="Budget" currency={cur} caption="Spending by category compared with budget" />
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Budget by category" />
          <CardBody>
            <ActionForm action={setBudgetAction.bind(null, slug, t.trip.id)} className="space-y-2">
              {EXPENSE_CATEGORIES.map((c) => (
                <div key={c} className="grid grid-cols-[1fr_9rem] items-center gap-3">
                  <label htmlFor={`b-${c}`} className="text-sm text-ink-2">
                    {expenseCategoryLabel[c]}
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-ink-3">$</span>
                    <input
                      id={`b-${c}`}
                      name={`budget_${c}`}
                      inputMode="decimal"
                      defaultValue={centsToInput(s.categories.find((x) => x.category === c)?.budgetCents ?? 0)}
                      className="w-full rounded-md border border-line-strong bg-surface py-1.5 pr-2 pl-6 text-right text-sm tabular-nums"
                    />
                  </div>
                </div>
              ))}
              <div className="pt-2">
                <SubmitButton variant="secondary">Save budget</SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Expenses" description="Committed = booked but not yet paid. Paid expenses are recorded in the ledger. Voiding keeps the record." />
        {expenses.length === 0 ? (
          <EmptyState title="No expenses recorded" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Expense</Th>
                <Th>Category</Th>
                <Th className="text-right">Amount</Th>
                <Th>Status</Th>
                <Th>Receipt</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className={e.status === "VOID" ? "opacity-60" : ""}>
                  <Td>
                    <div className={e.status === "VOID" ? "font-medium line-through" : "font-medium"}>{e.description}</div>
                    <div className="text-xs text-ink-3">
                      {e.vendor && `${e.vendor} · `}
                      {formatDate(e.incurredOn)}
                    </div>
                    {e.notes && <div className="mt-0.5 text-xs whitespace-pre-line text-ink-3">{e.notes}</div>}
                  </Td>
                  <Td className="text-ink-2">{expenseCategoryLabel[e.category]}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(e.amountCents, cur)}</Td>
                  <Td>
                    <Badge tone={e.status === "PAID" ? "good" : e.status === "COMMITTED" ? "warn" : "neutral"}>{expenseStatusLabel[e.status]}</Badge>
                    {e.paidOn && <div className="text-xs text-ink-3">{formatDate(e.paidOn)}</div>}
                  </Td>
                  <Td>
                    {e.receipt ? (
                      <a href={`/api/files/${e.receipt.id}`} className="text-sm text-accent hover:underline">
                        View
                      </a>
                    ) : e.status !== "VOID" ? (
                      <details>
                        <summary className="cursor-pointer text-sm text-ink-3">Attach</summary>
                        <ActionForm action={attachReceiptAction.bind(null, slug, t.trip.id, e.id)} className="mt-2 space-y-2">
                          <input type="file" name="receipt" aria-label="Receipt file" className="text-sm" />
                          <SubmitButton variant="secondary">Upload</SubmitButton>
                        </ActionForm>
                      </details>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="text-right">
                    {e.status !== "VOID" && (
                      <details className="relative inline-block text-left">
                        <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-sm text-ink-2 hover:bg-subtle">Actions</summary>
                        <div className="absolute right-0 z-20 mt-1 w-64 space-y-4 rounded-md border border-line bg-surface p-4 shadow-lg">
                          {e.status === "COMMITTED" && (
                            <ActionForm action={markExpensePaidAction.bind(null, slug, t.trip.id, e.id)} className="space-y-2">
                              <TextField label="Paid on" name="paidOn" type="date" defaultValue={toDateInput(new Date())} />
                              <SubmitButton variant="secondary">Mark paid</SubmitButton>
                            </ActionForm>
                          )}
                          <ActionForm action={voidExpenseAction.bind(null, slug, t.trip.id, e.id)} className="space-y-2">
                            <TextField label="Reason for voiding" name="reason" required />
                            <SubmitButton variant="danger" confirm="Void this expense? It stays on record but stops counting.">
                              Void
                            </SubmitButton>
                          </ActionForm>
                        </div>
                      </details>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <details className="border-t border-line">
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-accent">+ Record an expense</summary>
          <CardBody>
            <ActionForm action={createExpenseAction.bind(null, slug, t.trip.id)} resetOnSuccess className="grid gap-4 sm:grid-cols-2">
              <TextField label="Description" name="description" placeholder="Group airfare" required />
              <TextField label="Vendor" name="vendor" optional />
              <SelectField label="Category" name="category" options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: expenseCategoryLabel[c] }))} />
              <MoneyField label="Amount" name="amount" />
              <SelectField
                label="Status"
                name="status"
                options={[
                  { value: "COMMITTED", label: "Committed (booked, not yet paid)" },
                  { value: "PAID", label: "Paid" },
                ]}
              />
              <TextField label="Date incurred" name="incurredOn" type="date" defaultValue={toDateInput(new Date())} required />
              <TextField label="Date paid" name="paidOn" type="date" hint="Required if paid." optional />
              <TextField label="Receipt" name="receipt" type="file" hint={allowedTypesDescription()} optional />
              <TextArea label="Notes" name="notes" rows={2} className="sm:col-span-2" optional />
              <div className="sm:col-span-2">
                <SubmitButton>Record expense</SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </details>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Donor reports" description="Published reports appear on the public trip page. They contain totals only — never donor or participant names." />
          {reports.length > 0 && (
            <ul className="divide-y divide-line">
              {reports.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span>
                    <span className="font-medium">{r.title}</span>
                    {r.isFinal && <Badge tone="good" className="ml-2">Final</Badge>}
                  </span>
                  <span className="text-ink-3">{formatDateTime(r.publishedAt, t.org.timezone)}</span>
                </li>
              ))}
            </ul>
          )}
          <CardBody className={reports.length ? "border-t border-line" : ""}>
            {t.perms.administerFinances ? (
              <ActionForm action={publishReportAction.bind(null, slug, t.trip.id)} resetOnSuccess className="space-y-3">
                <p className="text-sm text-ink-2">Publishing takes a snapshot of today&apos;s figures above. Check them first — once published, donors can see it.</p>
                <TextField label="Title" name="title" placeholder={t.trip.status === "COMPLETED" ? "Final trip report" : "Fundraising update"} required />
                <TextArea label="Message to donors" name="narrative" rows={4} hint="Explain how funds were used in plain language." optional />
                <CheckboxField label="This is the final post-trip report" name="isFinal" />
                <SubmitButton confirm="Publish this report to the public trip page?">Publish report</SubmitButton>
              </ActionForm>
            ) : (
              <Alert tone="info">Church administrators publish donor reports.</Alert>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Ledger" description="Every money movement, newest first. Entries are never edited or deleted." />
          {ledger.length === 0 ? (
            <EmptyState title="No entries yet" />
          ) : (
            <ul className="divide-y divide-line">
              {ledger.map((l) => (
                <li key={l.id} className="flex justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{ledgerTypeLabel[l.type]}</span>
                    <span className="block truncate text-xs text-ink-3">
                      {formatDate(l.occurredAt)}
                      {l.memo && ` · ${l.memo}`}
                    </span>
                  </span>
                  <span className={l.amountCents < 0 ? "text-bad tabular-nums" : "text-good tabular-nums"}>
                    {l.amountCents < 0 ? "−" : "+"}
                    {formatMoney(Math.abs(l.amountCents), cur)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
