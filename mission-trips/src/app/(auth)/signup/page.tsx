import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton, TextField } from "@/components/forms";
import { Card } from "@/components/ui";
import { signupAction } from "../actions";
import { getCurrentUser } from "@/server/context";
import { safeNextPath } from "@/server/auth/cookies";

export const metadata = { title: "Create an account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  if (await getCurrentUser()) redirect(next);
  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="mt-1 mb-5 text-sm text-ink-3">For church staff, trip leaders, participants and donors.</p>
      <ActionForm action={signupAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <TextField label="Full name" name="name" autoComplete="name" required />
        <TextField label="Email" name="email" type="email" autoComplete="email" defaultValue={sp.email} required />
        <TextField label="Password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters." required />
        <SubmitButton className="w-full" pendingText="Creating account…">
          Create account
        </SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm text-ink-3">
        Already have an account?{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
