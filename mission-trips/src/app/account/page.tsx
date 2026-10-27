import Link from "next/link";
import { TopBar } from "@/components/top-bar";
import { Alert, Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { ActionForm, CheckboxField, SubmitButton } from "@/components/forms";
import { requireUser } from "@/server/context";
import { db } from "@/server/db";
import { savePreferencesAction } from "./actions";
import { resendVerificationAction } from "../(auth)/actions";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser();
  const prefs = await db.notificationPreference.findUnique({ where: { userId: user.id } });
  return (
    <>
      <TopBar user={user} />
      <main id="main" className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <PageHeader title="Account" description={`${user.name} · ${user.email}`} />
        <div className="space-y-6">
          <Card>
            <CardHeader title="Email address" />
            <CardBody className="space-y-3 text-sm">
              {user.emailVerifiedAt ? (
                <Alert tone="good">Your email address is confirmed.</Alert>
              ) : (
                <ActionForm action={resendVerificationAction}>
                  <Alert tone="warn">Your email address isn&apos;t confirmed yet.</Alert>
                  <SubmitButton variant="secondary" className="mt-3" pendingText="Sending…">
                    Send confirmation link
                  </SubmitButton>
                </ActionForm>
              )}
              <p className="text-ink-3">
                To change your password, use{" "}
                <Link href="/forgot-password" className="underline">
                  password reset
                </Link>
                .
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Email notifications" description="You'll always get emails about invitations, approvals and receipts." />
            <CardBody>
              <ActionForm action={savePreferencesAction} className="space-y-4">
                <CheckboxField label="Gifts" name="emailDonations" defaultChecked={prefs?.emailDonations ?? true} hint="When someone gives to your page or a trip you lead." />
                <CheckboxField label="Announcements" name="emailAnnouncements" defaultChecked={prefs?.emailAnnouncements ?? true} hint="Updates posted by your trip leaders." />
                <CheckboxField label="Deadlines and requirements" name="emailDeadlines" defaultChecked={prefs?.emailDeadlines ?? true} hint="Reminders and review results." />
                <CheckboxField label="Mission stories" name="emailStories" defaultChecked={prefs?.emailStories ?? true} hint="New stories from trips you're on or follow." />
                <CheckboxField label="Travel milestones" name="emailTravel" defaultChecked={prefs?.emailTravel ?? true} hint="Departures, arrivals and significant delays. Never includes locations." />
                <CheckboxField label="Mission reports" name="emailReports" defaultChecked={prefs?.emailReports ?? true} hint="When a trip you support publishes its final report." />
                <SubmitButton>Save preferences</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      </main>
    </>
  );
}
