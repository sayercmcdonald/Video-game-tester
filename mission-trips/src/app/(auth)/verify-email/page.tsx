import { Alert, Card, LinkButton } from "@/components/ui";
import { verifyEmail } from "@/server/services/accounts";
import { AppError } from "@/server/errors";

export const metadata = { title: "Confirm email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  let ok = false;
  let error = "This link is invalid or has expired.";
  try {
    await verifyEmail(token);
    ok = true;
  } catch (e) {
    if (e instanceof AppError) error = e.message;
    else throw e;
  }
  return (
    <Card className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">{ok ? "Email confirmed" : "Couldn't confirm email"}</h1>
      {ok ? <Alert tone="good">Thanks — your email address is confirmed.</Alert> : <Alert tone="bad">{error} You can request a new link from your account page.</Alert>}
      <LinkButton href="/home">Continue</LinkButton>
    </Card>
  );
}
