import Link from "next/link";
import { notFound } from "next/navigation";
import { findPublicCampaign } from "@/server/services/campaigns";
import { givingAvailability } from "@/server/services/donations";
import { getCurrentUser } from "@/server/context";
import { PublicShell } from "@/components/public-shell";
import { Alert, Card, CardBody } from "@/components/ui";
import { GoalMeter } from "@/components/charts";
import { DonateForm } from "@/components/donate-form";
import { formatMoney, percent } from "@/lib/money";
import { formatDateRange, formatDate } from "@/lib/dates";
import { donateAction } from "../../actions";

type Props = { params: Promise<{ org: string; campaign: string }>; searchParams: Promise<{ canceled?: string }> };

export async function generateMetadata({ params }: Props) {
  const { org, campaign } = await params;
  const data = await findPublicCampaign(org, campaign);
  return { title: data ? `${data.campaign.title} — ${data.campaign.org.name}` : "Give" };
}

export default async function GivePage({ params, searchParams }: Props) {
  const { org, campaign: slug } = await params;
  const { canceled } = await searchParams;
  const data = await findPublicCampaign(org, slug);
  if (!data) notFound();
  const { campaign: c, raisedCents, recentSupporters } = data;
  const fullOrg = { status: "ACTIVE" as const, stripeAccountId: c.org.stripeAccountId, stripeChargesEnabled: c.org.stripeChargesEnabled };
  const giving = givingAvailability(fullOrg);
  const accepting = giving.enabled && !c.isClosed && c.trip.status !== "COMPLETED";
  const user = await getCurrentUser();

  return (
    <PublicShell orgName={c.org.name}>
      <div className="grid gap-8 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <div>
            <p className="text-sm text-ink-3">
              {c.trip.name} · {c.trip.destination} · {formatDateRange(c.trip.startDate, c.trip.endDate)}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{c.title}</h1>
          </div>
          <div>
            <GoalMeter raised={raisedCents} goal={c.goalCents} currency={c.org.currency} label="Fundraising progress" />
            <p className="mt-2 text-ink-2 tabular-nums">
              <strong className="text-ink">{formatMoney(raisedCents, c.org.currency)}</strong> received toward {formatMoney(c.goalCents, c.org.currency)} ·{" "}
              {percent(raisedCents, c.goalCents)}%
            </p>
          </div>
          {c.story ? <p className="text-[17px] leading-relaxed whitespace-pre-line text-ink-2">{c.story}</p> : c.trip.summary && <p className="text-[17px] leading-relaxed whitespace-pre-line text-ink-2">{c.trip.summary}</p>}
          <Card>
            <CardBody className="space-y-1 text-sm">
              <div className="font-medium">How your gift is used</div>
              <p className="text-ink-2">{c.designationNote ?? `Gifts are received by ${c.org.name} to support ${c.trip.name}.`}</p>
              <p className="text-ink-3">
                Your gift is made to {c.org.name}, which manages trip funds under its own policies.{" "}
                <Link href={`/t/${c.org.slug}/${c.trip.slug}`} className="underline">
                  See trip updates and financial reports
                </Link>
                .
              </p>
            </CardBody>
          </Card>
          {recentSupporters.length > 0 && (
            <div>
              <h2 className="mb-3 font-semibold">Recent supporters</h2>
              <ul className="space-y-3">
                {recentSupporters.map((s) => (
                  <li key={s.id} className="text-sm">
                    <span className="font-medium">{s.name}</span> <span className="text-ink-3">· {formatDate(s.receivedAt)}</span>
                    {s.message && <p className="text-ink-2">“{s.message}”</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="lg:col-span-2">
          <Card className="p-6 lg:sticky lg:top-6">
            <h2 className="mb-4 text-lg font-semibold">Give</h2>
            {canceled && (
              <div className="mb-4">
                <Alert tone="info">Checkout was canceled. You haven&apos;t been charged.</Alert>
              </div>
            )}
            {accepting ? (
              <DonateForm action={donateAction.bind(null, c.org.slug, c.slug)} defaultName={user?.name} defaultEmail={user?.email} />
            ) : (
              <Alert tone="info" title="Not accepting online gifts right now">
                {c.isClosed || c.trip.status === "COMPLETED" ? "This campaign has closed. Thank you to everyone who gave." : !giving.enabled ? giving.reason : null} To give another way, contact{" "}
                {c.org.name}.
              </Alert>
            )}
          </Card>
        </div>
      </div>
    </PublicShell>
  );
}
