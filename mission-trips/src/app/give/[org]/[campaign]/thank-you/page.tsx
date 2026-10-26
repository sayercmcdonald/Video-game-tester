import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { PublicShell } from "@/components/public-shell";
import { Alert, Card, LinkButton } from "@/components/ui";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Thank you" };
export const dynamic = "force-dynamic";

// This page never assumes the payment worked just because the donor was sent
// here. It shows the status recorded from Stripe's signed confirmation.
export default async function ThankYouPage({ params, searchParams }: { params: Promise<{ org: string; campaign: string }>; searchParams: Promise<{ donation?: string }> }) {
  const { org, campaign } = await params;
  const { donation: id } = await searchParams;
  if (!id) notFound();
  const d = await db.donation.findFirst({
    where: { id, org: { slug: org }, campaign: { slug: campaign } },
    select: { status: true, amountCents: true, currency: true, campaign: { select: { title: true } }, org: { select: { name: true } }, trip: { select: { slug: true } } },
  });
  if (!d) notFound();

  return (
    <PublicShell orgName={d.org.name}>
      <Card className="mx-auto max-w-lg space-y-4 p-8 text-center">
        {d.status === "SUCCEEDED" || d.status === "PARTIALLY_REFUNDED" ? (
          <>
            <h1 className="text-2xl font-semibold">Thank you!</h1>
            <p className="text-ink-2">
              Your gift of <strong>{formatMoney(d.amountCents, d.currency)}</strong> to “{d.campaign.title}” was received. A receipt is on its way to your email.
            </p>
          </>
        ) : d.status === "PENDING" ? (
          <>
            <h1 className="text-2xl font-semibold">Confirming your gift…</h1>
            <Alert tone="info">
              We&apos;re waiting for the payment processor to confirm your {formatMoney(d.amountCents, d.currency)} gift. This usually takes a few seconds. Bank payments can take a few
              days. You&apos;ll get an email receipt once it&apos;s confirmed.
            </Alert>
            <LinkButton href={`/give/${org}/${campaign}/thank-you?donation=${id}`} variant="secondary">
              Check again
            </LinkButton>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">Your gift didn&apos;t go through</h1>
            <Alert tone="bad">The payment wasn&apos;t completed, so you haven&apos;t been charged.</Alert>
            <LinkButton href={`/give/${org}/${campaign}`}>Try again</LinkButton>
          </>
        )}
        <p className="pt-2 text-sm">
          <Link href={`/t/${org}/${d.trip.slug}`} className="text-accent hover:underline">
            Follow the trip&apos;s updates
          </Link>
        </p>
      </Card>
    </PublicShell>
  );
}
