import { ActionForm, SubmitButton, TextField } from "@/components/forms";
import { Card } from "@/components/ui";
import { resetPasswordAction } from "../actions";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <p className="mt-1 mb-5 text-sm text-ink-3">You&apos;ll be signed out of other devices.</p>
      <ActionForm action={resetPasswordAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <TextField label="New password" name="password" type="password" autoComplete="new-password" hint="At least 10 characters." required />
        <TextField label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required />
        <SubmitButton className="w-full">Save new password</SubmitButton>
      </ActionForm>
    </Card>
  );
}
