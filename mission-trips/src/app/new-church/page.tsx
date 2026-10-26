import { TopBar } from "@/components/top-bar";
import { ActionForm, SubmitButton, TextField, SelectField } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/context";
import { createOrgAction } from "../o/[org]/actions";
import { TIMEZONES } from "@/lib/timezones";

export const metadata = { title: "Set up your church" };

export default async function NewChurchPage() {
  const user = await requireUser();
  return (
    <>
      <TopBar user={user} />
      <main id="main" className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        <PageHeader title="Set up your church" description="You'll be the first administrator. You can invite staff and leaders next." />
        <Card className="p-6">
          <ActionForm action={createOrgAction} className="space-y-5">
            <TextField label="Church name" name="name" placeholder="Grace Community Church" required />
            <TextField label="Web address" name="slug" placeholder="grace-community" hint="Used in links, like /give/grace-community/… Lowercase letters, numbers and hyphens." required />
            <TextField label="Church office email" name="contactEmail" type="email" defaultValue={user.email} hint="Shown to donors on receipts and used for your payment account." required />
            <SelectField label="Time zone" name="timezone" options={TIMEZONES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))} defaultValue="America/Chicago" />
            <p className="text-sm text-ink-3">
              New churches are reviewed by the platform team before public giving pages go live. You can set up trips and invite your team right away.
            </p>
            <SubmitButton pendingText="Creating…">Create church workspace</SubmitButton>
          </ActionForm>
        </Card>
      </main>
    </>
  );
}
