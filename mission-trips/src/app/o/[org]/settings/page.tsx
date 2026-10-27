import { pageOrgAdmin } from "@/server/page-guard";
import { Alert, Badge, Card, CardBody, CardHeader, ListRow, PageHeader } from "@/components/ui";
import { ActionForm, SelectField, SubmitButton, TextArea, TextField } from "@/components/forms";
import { TIMEZONES } from "@/lib/timezones";
import { updateOrgSettingsAction } from "../actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const ctx = await pageOrgAdmin(org);
  const o = ctx.org;
  const tz = TIMEZONES.includes(o.timezone) ? TIMEZONES : [o.timezone, ...TIMEZONES];
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" />
      <Card>
        <ul className="divide-y divide-line">
          <li>
            <ListRow href={`/o/${o.slug}/settings/payments`} title="Payments" subtitle="Connect Stripe so gifts go straight to your bank account" trailing={<Badge tone={o.stripeChargesEnabled ? "good" : "neutral"}>{o.stripeChargesEnabled ? "On" : "Off"}</Badge>} />
          </li>
          <li>
            <ListRow href={`/o/${o.slug}/audit`} title="Activity log" subtitle="Every change, money movement and view of private records" />
          </li>
          <li>
            <ListRow href={`/o/${o.slug}/profile`} title="My profile" subtitle="Your contact, emergency and health details" />
          </li>
        </ul>
      </Card>
      <Card>
        <CardHeader title="Church details" />
        <CardBody>
          <ActionForm action={updateOrgSettingsAction.bind(null, o.slug)} className="space-y-5">
            <TextField label="Church name" name="name" defaultValue={o.name} required />
            <TextField label="Office email" name="contactEmail" type="email" defaultValue={o.contactEmail} hint="Shown on receipts." required />
            <SelectField label="Time zone" name="timezone" defaultValue={o.timezone} options={tz.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))} />
            <div className="border-t border-line pt-5">
              <h3 className="mb-1 text-sm font-semibold">Receipts</h3>
              <div className="mb-4">
                <Alert tone="info">
                  Mission Trips never states that a gift is tax-deductible. Receipts show exactly the wording you enter below. Confirm it with your accountant or
                  denomination before going live.
                </Alert>
              </div>
              <div className="space-y-4">
                <TextField label="Legal name" name="legalName" defaultValue={o.legalName ?? ""} hint="As registered, if different from the church name." optional />
                <TextField label="Tax ID / EIN" name="taxId" defaultValue={o.taxId ?? ""} optional />
                <TextArea
                  label="Receipt statement"
                  name="receiptStatement"
                  rows={4}
                  defaultValue={o.receiptStatement ?? ""}
                  hint='For example: "No goods or services were provided in exchange for this contribution." Leave blank to show no statement.'
                  optional
                />
              </div>
            </div>
            <SubmitButton>Save settings</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}
