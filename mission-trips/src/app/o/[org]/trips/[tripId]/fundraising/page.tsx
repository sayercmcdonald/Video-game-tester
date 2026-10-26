import Link from "next/link";
import { notFound } from "next/navigation";
import { pageTrip } from "@/server/page-guard";
import type { TripContext } from "@/server/context";
import { db } from "@/server/db";
import { tripCampaignsWithProgress } from "@/server/services/campaigns";
import { givingAvailability } from "@/server/services/donations";
import { appUrl } from "@/server/email";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui";
import { ActionButton, ActionForm, CheckboxField, MoneyField, SelectField, SubmitButton, TextArea, TextField } from "@/components/forms";
import { GoalMeter } from "@/components/charts";
import { CopyLink } from "@/components/copy-link";
import { centsToInput, formatMoney, percent } from "@/lib/money";
import { formatDate, toDateInput } from "@/lib/dates";
import { donationMethodLabel, donationStatusLabel, donationStatusTone, restrictionLabel } from "@/lib/labels";
import {
  createPledgeAction,
  createProjectCampaignAction,
  recordOfflineDonationAction,
  refundAction,
  setPledgeStatusAction,
  updateCampaignAction,
} from "../actions";

export const metadata = { title: "Fundraising" };

type Campaigns = Awaited<ReturnType<typeof tripCampaignsWithProgress>>;

export default async function FundraisingPage({ params }: { params: Promise<{ org: string; tripId: string }> }) {
  const { org, tripId } = await params;
  const t = await pageTrip(org, tripId);
  if (!t.perms.viewTeam) notFound();
  const campaigns = await tripCampaignsWithProgress(t.trip.id, t.org.id);
  const giving = givingAvailability(t.org);
  return (
    <div className="space-y-6">
      {!giving.enabled && (
        <Alert tone="warn" title="Online giving is not available yet">
          {giving.reason} You can still record checks and cash{t.perms.isOrgAdmin ? "" : " (church admins)"}, and track pledges.
        </Alert>
      )}
      {t.perms.manage ? <ManagerView t={t} campaigns={campaigns} givingOn={giving.enabled} /> : <ParticipantView t={t} campaigns={campaigns} givingOn={giving.enabled} />}
    </div>
  );
}

function CampaignEditor({ t, c, canManage }: { t: TripContext; c: Campaigns[number]; canManage: boolean }) {
  return (
    <ActionForm action={updateCampaignAction.bind(null, t.org.slug, t.trip.id, c.id)} className="space-y-4">
      <TextField label="Page title" name="title" defaultValue={c.title} required />
      <TextArea label="Story" name="story" defaultValue={c.story} rows={6} hint="Why this trip matters. Shown publicly — don't include private details." optional />
      <MoneyField label="Goal" name="goal" defaultValue={centsToInput(c.goalCents)} className="sm:max-w-56" />
      {canManage ? (
        <>
          <TextArea label="How gifts are used" name="designationNote" defaultValue={c.designationNote ?? ""} rows={2} hint="Shown to donors. Must match your church's actual policy." optional />
          <CheckboxField label="Public giving page" name="isPublic" defaultChecked={c.isPublic} />
          <CheckboxField label="Closed to new gifts" name="isClosed" defaultChecked={c.isClosed} />
        </>
      ) : (
        <>
          {c.isPublic && <input type="hidden" name="isPublic" value="on" />}
          {c.isClosed && <input type="hidden" name="isClosed" value="on" />}
        </>
      )}
      <SubmitButton>Save</SubmitButton>
    </ActionForm>
  );
}

async function ParticipantView({ t, campaigns, givingOn }: { t: TripContext; campaigns: Campaigns; givingOn: boolean }) {
  const mine = campaigns.find((c) => c.tripMemberId && c.tripMemberId === t.tripMember?.id);
  if (!mine) return <EmptyState title="No support page yet">Your page is created when a leader approves you for the trip.</EmptyState>;
  const [gifts, pledges] = await Promise.all([
    db.donation.findMany({
      where: { campaignId: mine.id, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } },
      orderBy: { receivedAt: "desc" },
      select: { id: true, donorName: true, amountCents: true, refundedCents: true, receivedAt: true, message: true, isAnonymous: true },
    }),
    db.pledge.findMany({ where: { campaignId: mine.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const cur = t.org.currency;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-6 lg:col-span-3">
        <Card>
          <CardHeader title="My support page" />
          <CardBody className="space-y-4">
            <GoalMeter raised={mine.raisedCents} goal={mine.goalCents} currency={cur} label="My fundraising progress" />
            <p className="text-sm text-ink-2 tabular-nums">
              <strong>{formatMoney(mine.raisedCents, cur)}</strong> received of {formatMoney(mine.goalCents, cur)} ({percent(mine.raisedCents, mine.goalCents)}%)
            </p>
            {givingOn && t.trip.status !== "DRAFT" && <CopyLink url={appUrl(`/give/${t.org.slug}/${mine.slug}`)} />}
          </CardBody>
          <CardBody className="border-t border-line">
            <CampaignEditor t={t} c={mine} canManage={false} />
          </CardBody>
        </Card>
      </div>
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader title="My supporters" description="So you can say thank you." />
          {gifts.length === 0 ? (
            <EmptyState title="No gifts yet" />
          ) : (
            <ul className="divide-y divide-line">
              {gifts.map((g) => (
                <li key={g.id} className="px-5 py-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{g.donorName}</span>
                    <span className="tabular-nums">{formatMoney(g.amountCents - g.refundedCents, cur)}</span>
                  </div>
                  {g.message && <p className="text-ink-2">“{g.message}”</p>}
                  <div className="text-xs text-ink-3">
                    {formatDate(g.receivedAt)}
                    {g.isAnonymous && " · asked to be anonymous publicly"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <PledgesCard t={t} pledges={pledges} campaigns={[mine]} canClose />
      </div>
    </div>
  );
}

function PledgesCard({ t, pledges, campaigns, canClose }: { t: TripContext; pledges: Awaited<ReturnType<typeof db.pledge.findMany>>; campaigns: Campaigns; canClose: boolean }) {
  const cur = t.org.currency;
  return (
    <Card>
      <CardHeader title="Pledges" description="Promised gifts. Tracked separately and never counted as received." />
      {pledges.length > 0 && (
        <ul className="divide-y divide-line">
          {pledges.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{p.donorName}</span>
                <span className="block text-xs text-ink-3">
                  {campaigns.length > 1 && `${campaigns.find((c) => c.id === p.campaignId)?.title ?? ""} · `}
                  {p.expectedBy ? `expected ${formatDate(p.expectedBy)}` : "no date"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums">{formatMoney(p.amountCents, cur)}</span>
                {p.status === "OPEN" && canClose ? (
                  <>
                    <ActionButton action={setPledgeStatusAction.bind(null, t.org.slug, t.trip.id, p.id, "FULFILLED")} variant="ghost">
                      Mark received
                    </ActionButton>
                    <ActionButton action={setPledgeStatusAction.bind(null, t.org.slug, t.trip.id, p.id, "CANCELLED")} variant="ghost">
                      Cancel
                    </ActionButton>
                  </>
                ) : (
                  <Badge tone={p.status === "OPEN" ? "warn" : p.status === "FULFILLED" ? "good" : "neutral"}>{p.status === "OPEN" ? "Open" : p.status === "FULFILLED" ? "Fulfilled" : "Cancelled"}</Badge>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <details className="border-t border-line">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-accent">+ Add a pledge</summary>
        <CardBody>
          <ActionForm action={createPledgeAction.bind(null, t.org.slug, t.trip.id)} resetOnSuccess className="space-y-3">
            {campaigns.length === 1 ? (
              <input type="hidden" name="campaignId" value={campaigns[0].id} />
            ) : (
              <SelectField label="For" name="campaignId" options={campaigns.map((c) => ({ value: c.id, label: c.title }))} />
            )}
            <TextField label="Who pledged" name="donorName" required />
            <TextField label="Their email" name="donorEmail" type="email" optional />
            <MoneyField label="Amount" name="amount" />
            <TextField label="Expected by" name="expectedBy" type="date" optional />
            <TextArea label="Note" name="note" rows={2} optional />
            <SubmitButton variant="secondary">Save pledge</SubmitButton>
          </ActionForm>
          <p className="mt-3 text-xs text-ink-3">When the money arrives, it should come through the giving page or be recorded by a church admin. Then mark the pledge received.</p>
        </CardBody>
      </details>
    </Card>
  );
}

async function ManagerView({ t, campaigns, givingOn }: { t: TripContext; campaigns: Campaigns; givingOn: boolean }) {
  const cur = t.org.currency;
  const base = t.org.slug;
  const [donations, pledges] = await Promise.all([
    t.perms.viewFinances
      ? db.donation.findMany({
          where: { tripId: t.trip.id, orgId: t.org.id, status: { notIn: ["CANCELED"] } },
          orderBy: { createdAt: "desc" },
          take: 200,
          include: { campaign: { select: { title: true } } },
        })
      : Promise.resolve([]),
    db.pledge.findMany({ where: { tripId: t.trip.id, orgId: t.org.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const ordered = [...campaigns.filter((c) => c.kind !== "PARTICIPANT"), ...campaigns.filter((c) => c.kind === "PARTICIPANT")];

  return (
    <>
      <Card>
        <CardHeader title="Campaigns" description="The team fund, project funds, and each participant's support page." />
        <Table>
          <thead>
            <tr>
              <Th>Campaign</Th>
              <Th className="w-[30%]">Progress</Th>
              <Th className="text-right">Raised</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {ordered.map((c) => (
              <tr key={c.id}>
                <Td>
                  <div className="font-medium">{c.kind === "PARTICIPANT" ? (c.tripMember?.user.name ?? c.title) : c.title}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1.5">
                    <Badge>{c.kind === "TRIP" ? "Team fund" : c.kind === "PROJECT" ? "Project" : "Participant"}</Badge>
                    {c.restriction === "UNRESTRICTED" && <Badge tone="info">{restrictionLabel.UNRESTRICTED}</Badge>}
                    {!c.isPublic && <Badge tone="neutral">Private</Badge>}
                    {c.isClosed && <Badge tone="neutral">Closed</Badge>}
                    {c.tripMember && c.tripMember.status !== "APPROVED" && <Badge tone="warn">Not on team</Badge>}
                  </div>
                </Td>
                <Td>
                  <GoalMeter raised={c.raisedCents} goal={c.goalCents} currency={cur} label={`${c.title} progress`} />
                </Td>
                <Td className="text-right tabular-nums">
                  {formatMoney(c.raisedCents, cur, { compact: true })}
                  <span className="text-ink-3"> / {formatMoney(c.goalCents, cur, { compact: true })}</span>
                </Td>
                <Td className="text-right">
                  <details className="relative inline-block text-left">
                    <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-sm text-accent hover:bg-subtle">Edit</summary>
                    <div className="absolute right-0 z-20 mt-1 w-[min(90vw,28rem)] rounded-md border border-line bg-surface p-5 shadow-lg">
                      <CampaignEditor t={t} c={c} canManage />
                      {givingOn && c.isPublic && t.trip.status !== "DRAFT" && (
                        <div className="mt-4 border-t border-line pt-4">
                          <CopyLink url={appUrl(`/give/${base}/${c.slug}`)} />
                        </div>
                      )}
                    </div>
                  </details>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <details className="border-t border-line">
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-accent">+ New project campaign</summary>
          <CardBody>
            <ActionForm action={createProjectCampaignAction.bind(null, base, t.trip.id)} resetOnSuccess className="max-w-xl space-y-4">
              <TextField label="Title" name="title" placeholder="Water filters for the clinic" required />
              <TextArea label="Story" name="story" optional />
              <MoneyField label="Goal" name="goal" />
              <SelectField
                label="Restriction"
                name="restriction"
                hint="Use 'designated' unless your church's policy says otherwise."
                options={[
                  { value: "RESTRICTED", label: "Designated for this trip" },
                  { value: "UNRESTRICTED", label: "Unrestricted" },
                ]}
              />
              <TextArea label="How gifts are used" name="designationNote" rows={2} optional />
              <SubmitButton>Create campaign</SubmitButton>
            </ActionForm>
          </CardBody>
        </details>
      </Card>

      {t.perms.viewFinances ? (
        <Card>
          <CardHeader
            title="Gifts"
            description={t.perms.administerFinances ? "Every gift to this trip, including pending and failed online attempts." : "Gifts to this trip. Refunds and offline gifts are handled by church admins."}
          />
          {donations.length === 0 ? (
            <EmptyState title="No gifts yet">Online gifts appear here as soon as someone starts checkout, and are marked received only when Stripe confirms payment.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Donor</Th>
                  <Th>For</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Status</Th>
                  <Th>Date</Th>
                  {t.perms.administerFinances && <Th />}
                </tr>
              </thead>
              <tbody>
                {donations.map((d) => (
                  <tr key={d.id}>
                    <Td>
                      <div className="font-medium">{d.donorName}</div>
                      {t.perms.administerFinances && d.donorEmail && <div className="text-xs text-ink-3">{d.donorEmail}</div>}
                    </Td>
                    <Td className="max-w-48 truncate text-ink-2">{d.campaign.title}</Td>
                    <Td className="text-right tabular-nums">
                      {formatMoney(d.amountCents, d.currency)}
                      {d.refundedCents > 0 && <div className="text-xs text-bad">−{formatMoney(d.refundedCents, d.currency)} refunded</div>}
                      {d.feeCents > 0 && <div className="text-xs text-ink-3">fee {formatMoney(d.feeCents, d.currency)}</div>}
                    </Td>
                    <Td>
                      <Badge tone={donationStatusTone[d.status]}>{donationStatusLabel[d.status]}</Badge>
                      <div className="mt-0.5 text-xs text-ink-3">
                        {donationMethodLabel[d.method]}
                        {d.offlineReference && ` #${d.offlineReference}`}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDate(d.receivedAt ?? d.createdAt)}</Td>
                    {t.perms.administerFinances && (
                      <Td className="text-right whitespace-nowrap">
                        {d.receiptNumber != null && (
                          <Link href={`/receipts/${d.id}`} className="mr-2 text-sm text-accent hover:underline">
                            Receipt
                          </Link>
                        )}
                        {(d.status === "SUCCEEDED" || d.status === "PARTIALLY_REFUNDED") && (
                          <details className="relative inline-block text-left">
                            <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-sm text-ink-2 hover:bg-subtle">Refund</summary>
                            <div className="absolute right-0 z-20 mt-1 w-72 rounded-md border border-line bg-surface p-4 text-left whitespace-normal shadow-lg">
                              <ActionForm action={refundAction.bind(null, base, t.trip.id, d.id)} className="space-y-3">
                                <MoneyField label="Amount to refund" name="amount" defaultValue={centsToInput(d.amountCents - d.refundedCents)} />
                                <SelectField
                                  label="Reason"
                                  name="reason"
                                  options={[
                                    { value: "requested_by_customer", label: "Donor asked" },
                                    { value: "duplicate", label: "Duplicate gift" },
                                    { value: "fraudulent", label: "Fraudulent" },
                                  ]}
                                />
                                <SubmitButton variant="danger" confirm="Refund this gift? This returns money to the donor and can't be undone.">
                                  Issue refund
                                </SubmitButton>
                              </ActionForm>
                            </div>
                          </details>
                        )}
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ) : (
        <Alert tone="info">Individual gift details for this trip are visible to church administrators.</Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {t.perms.administerFinances && (
          <Card>
            <CardHeader title="Record a check or cash gift" description="For gifts that didn't come through the online giving page. A receipt is issued automatically." />
            <CardBody>
              <ActionForm action={recordOfflineDonationAction.bind(null, base, t.trip.id)} resetOnSuccess className="space-y-3">
                <SelectField label="For" name="campaignId" options={ordered.map((c) => ({ value: c.id, label: c.kind === "PARTICIPANT" ? `Support ${c.tripMember?.user.name ?? ""}` : c.title }))} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField label="Donor name" name="donorName" required />
                  <TextField label="Donor email" name="donorEmail" type="email" hint="To email the receipt." optional />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <MoneyField label="Amount" name="amount" />
                  <SelectField
                    label="Method"
                    name="method"
                    options={[
                      { value: "CHECK", label: "Check" },
                      { value: "CASH", label: "Cash" },
                      { value: "OTHER_OFFLINE", label: "Other" },
                    ]}
                  />
                  <TextField label="Check #" name="reference" optional />
                </div>
                <TextField label="Date received" name="receivedOn" type="date" defaultValue={toDateInput(new Date())} required />
                <CheckboxField label="Keep the donor's name off public pages" name="isAnonymous" />
                <SubmitButton>Record gift</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        )}
        <PledgesCard t={t} pledges={pledges} campaigns={ordered} canClose />
      </div>
    </>
  );
}
