import { handleStripeWebhook } from "@/server/payments/webhooks";
import { stripeGateway } from "@/server/payments/gateway";

// Stripe calls this endpoint with signed events. The raw body is required to
// verify the signature, so it is read as text before any parsing.
export async function POST(req: Request) {
  const raw = await req.text();
  const result = await handleStripeWebhook(stripeGateway, raw, req.headers.get("stripe-signature"));
  return new Response(result.body, { status: result.status });
}
