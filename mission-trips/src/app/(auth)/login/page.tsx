import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton, TextField } from "@/components/forms";
import { Alert, Card } from "@/components/ui";
import { loginAction } from "../actions";
import { getCurrentUser } from "@/server/context";
import { safeNextPath } from "@/server/auth/cookies";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  if (await getCurrentUser()) redirect(next);
  return (
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
  );
}
