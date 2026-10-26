import { pageOrg } from "@/server/page-guard";
import { getProfile } from "@/server/services/profiles";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton, TextArea, TextField } from "@/components/forms";
import { toDateInput } from "@/lib/dates";
import { updateProfileAction } from "../actions";

export const metadata = { title: "My profile" };

export default async function MyProfilePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await pageOrg(org);
  const { profile, sensitive } = await getProfile(ctx, ctx.user.id);
  return (
    <div className="max-w-2xl">
      <PageHeader title="My profile" description={`Details ${ctx.org.name} needs for trips. Only you, your trip leaders and church administrators can see this.`} />
      <Card className="p-6">
        <ActionForm action={updateProfileAction.bind(null, ctx.org.slug)} className="space-y-6">
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">Contact</legend>
            <TextField label="Mobile phone" name="phone" type="tel" autoComplete="tel" defaultValue={profile?.phone ?? ""} optional />
            <TextField label="Date of birth" name="dateOfBirth" type="date" defaultValue={toDateInput(profile?.dateOfBirth)} optional />
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">Emergency contact</legend>
            <TextField label="Name" name="emergencyContactName" defaultValue={profile?.emergencyContactName ?? ""} optional />
            <TextField label="Relationship" name="emergencyContactRelation" defaultValue={profile?.emergencyContactRelation ?? ""} optional />
            <TextField label="Phone" name="emergencyContactPhone" type="tel" defaultValue={profile?.emergencyContactPhone ?? ""} optional />
          </fieldset>
          <fieldset className="space-y-4">
            <legend className="mb-1 text-sm font-semibold">Health</legend>
            <p className="text-sm text-ink-3">Stored encrypted. Share what leaders need to keep you safe.</p>
            <TextArea label="Allergies" name="allergies" rows={2} defaultValue={sensitive.allergies ?? ""} optional />
            <TextArea label="Medications" name="medications" rows={2} defaultValue={sensitive.medications ?? ""} optional />
            <TextArea label="Other medical notes" name="medicalNotes" rows={3} defaultValue={sensitive.medicalNotes ?? ""} optional />
          </fieldset>
          <SubmitButton>Save profile</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
