import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton, TextField } from "@/components/forms";
import { DemoPending } from "@/components/demo-pending";
import { Alert, Card } from "@/components/ui";
import { demoLoginAction, loginAction } from "../actions";
import { env } from "@/server/env";
import { DEMO_ACCOUNTS } from "@/lib/demo";
import { getCurrentUser } from "@/server/context";
import { safeNextPath } from "@/server/auth/cookies";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  if (await getCurrentUser()) redirect(next);
  const demo = env().DEMO_MODE;
  return (
    <>
    {demo && (
      <Card className="mb-4 p-6" id="demo">
        <h1 className="text-xl font-semibold">Explore the demo</h1>
        <p className="mt-1 mb-4 text-sm text-ink-3">A sample church with one trip. Tap a person to see Sent through their eyes. Nothing here is real.</p>
        <ul className="divide-y divide-line">
          {DEMO_ACCOUNTS.map((a) => (
            <li key={a.email}>
              <ActionForm action={demoLoginAction}>
                <input type="hidden" name="email" value={a.email} />
                <button type="submit" className="flex min-h-14 w-full items-center justify-between gap-3 py-2.5 text-left">
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {a.name} · <span className="text-ink-2">{a.role}</span>
                    </span>
                    <span className="block text-sm text-ink-3">{a.what}</span>
                  </span>
                  <DemoPending />
                </button>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Card>
    )}
    <Card className="p-6">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mt-1 mb-5 text-sm text-ink-3">Welcome back.</p>
      {sp.reset && (
        <div className="mb-4">
          <Alert tone="good">Your password was changed. Sign in with your new password.</Alert>
        </div>
      )}
      <ActionForm action={loginAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <TextField label="Email" name="email" type="email" autoComplete="email" required />
        <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
        <SubmitButton className="w-full" pendingText="Signing in…">
          Sign in
        </SubmitButton>
      </ActionForm>
      <div className="mt-5 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-ink-2 hover:text-ink hover:underline">
          Forgot password?
        </Link>
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </div>
    </Card>
    </>
  );
}
