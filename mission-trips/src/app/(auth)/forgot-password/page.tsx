import Link from "next/link";
import { ActionForm, SubmitButton, TextField } from "@/components/forms";
import { Card } from "@/components/ui";
import { forgotPasswordAction } from "../actions";

export const metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="mt-1 mb-5 text-sm text-ink-3">We&apos;ll email you a link to choose a new one.</p>
      <ActionForm action={forgotPasswordAction} className="space-y-4">
        <TextField label="Email" name="email" type="email" autoComplete="email" required />
        <SubmitButton className="w-full" pendingText="Sending…">
          Send reset link
        </SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm">
        <Link href="/login" className="text-ink-2 hover:underline">
          Back to sign in
        </Link>
      </p>
    </Card>
  );
}
