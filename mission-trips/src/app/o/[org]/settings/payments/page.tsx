import { pageOrgAdmin } from "@/server/page-guard";
import { refreshStripeStatus } from "@/server/services/platform";
import { givingAvailability } from "@/server/services/donations";
import { stripeConfigured, stripeGateway } from "@/server/payments/gateway";
import { env } from "@/server/env";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { startPaymentsOnboardingAction } from "../../actions";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await pageOrgAdmin(org);
  let chargesEnabled = ctx.org.stripeChargesEnabled;
  let refreshError = false;
  if (ctx.org.stripeAccountId && stripeConfigured()) {
    try {
      chargesEnabled = await refreshStripeStatus(stripeGateway, ctx);
    } catch (e) {
      console.error("[payments] status refresh failed", e);
      refreshError = true;
    }
  }
  const giving = givingAvailability({ ...ctx.org, stripeChargesEnabled: chargesEnabled });
  const mode = env().STRIPE_MODE;

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Payments" description="How online gifts reach your church." />
      <Card>
        <CardHeader title="Online giving" action={giving.enabled ? <Badge tone="good">On</Badge> : <Badge tone="warn">Off</Badge>} />
        <CardBody className="space-y-4 text-sm">
          {giving.enabled ? <Alert tone="good">Your giving pages are accepting gifts.</Alert> : <Alert tone="warn">{giving.reason}</Alert>}
          {refreshError && <Alert tone="bad">We couldn&apos;t reach Stripe to check your account status. Try again shortly.</Alert>}
          {ctx.org.status !== "ACTIVE" && <p className="text-ink-2">Your church is awaiting platform approval. You can connect Stripe now so you&apos;re ready.</p>}
          {!stripeConfigured() ? (
            <p className="text-ink-2">The server administrator needs to add Stripe API keys before any church can accept online gifts.</p>
          ) : mode === "platform" ? (
            <p className="text-ink-2">This server collects gifts through a single Stripe account managed by the server administrator.</p>
          ) : (
            <>
              <p className="text-ink-2">
                Your church connects its <strong>own</strong> Stripe account. Gifts are charged on that account and paid out to your bank by Stripe; Sent
                never holds your money. Stripe will ask for your church&apos;s legal details and bank account.
              </p>
              {ctx.org.stripeAccountId && (
                <p className="text-ink-3">
                  Connected account: <code className="font-mono">{ctx.org.stripeAccountId}</code> · {chargesEnabled ? "ready to accept payments" : "setup not finished"}
                </p>
              )}
              {!chargesEnabled && (
                <ActionForm action={startPaymentsOnboardingAction.bind(null, ctx.org.slug)}>
                  <SubmitButton pendingText="Opening Stripe…">{ctx.org.stripeAccountId ? "Continue Stripe setup" : "Connect with Stripe"}</SubmitButton>
                </ActionForm>
              )}
            </>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Webhook" description="For the server administrator." />
        <CardBody className="text-sm text-ink-2">
          Stripe must send events to <code className="font-mono">{env().APP_URL}/api/stripe/webhook</code>. Gifts are only marked received when these signed events
          arrive (or the hourly reconciliation job confirms them with Stripe).
        </CardBody>
      </Card>
    </div>
  );
}
