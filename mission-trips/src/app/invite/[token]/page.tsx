import { Logo } from "@/components/brand";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Card, LinkButton } from "@/components/ui";
import { getCurrentUser } from "@/server/context";
import { findInvitation } from "@/server/services/orgs";
import { acceptInviteAction } from "./actions";

export const metadata = { title: "Invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await findInvitation(token);
  const user = await getCurrentUser();
  const here = `/invite/${token}`;

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pt-16">
      <div className="mb-8">
        <Logo />
      </div>
      <main id="main" className="w-full max-w-md">
        <Card className="space-y-4 p-6">
          {!inv ? (
            <>
              <h1 className="text-xl font-semibold">This invitation can&apos;t be used</h1>
              <p className="text-ink-2">It may have expired, been revoked, or already been accepted. Ask the person who invited you to send a new one.</p>
              <LinkButton href="/home" variant="secondary">
                Go to my account
              </LinkButton>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold">You&apos;re invited to {inv.trip ? inv.trip.name : inv.org.name}</h1>
              <p className="text-ink-2">
                {inv.org.name} invited <strong>{inv.email}</strong>
                {inv.trip ? ` to join ${inv.trip.name} as a ${inv.tripRole === "LEADER" ? "trip leader" : "participant"}.` : inv.orgRole === "ADMIN" ? " to help administer their workspace." : " to their workspace."}
              </p>
              {!user ? (
                <div className="flex flex-wrap gap-2">
                  <LinkButton href={`/signup?next=${encodeURIComponent(here)}&email=${encodeURIComponent(inv.email)}`}>Create an account</LinkButton>
                  <LinkButton href={`/login?next=${encodeURIComponent(here)}`} variant="secondary">
                    I already have an account
                  </LinkButton>
                </div>
              ) : user.email.toLowerCase() !== inv.email ? (
                <Alert tone="warn" title="Different email address">
                  You&apos;re signed in as {user.email}, but this invitation is for {inv.email}. Sign out and sign in (or create an account) with {inv.email}.
                </Alert>
              ) : (
                <ActionForm action={acceptInviteAction.bind(null, token)}>
                  <SubmitButton pendingText="Joining…">Accept invitation</SubmitButton>
                </ActionForm>
              )}
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
