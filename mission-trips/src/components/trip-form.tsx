"use client";

import { ActionForm, CheckboxField, MoneyField, SubmitButton, TextArea, TextField, type ActionState } from "./forms";

type TripDefaults = {
  name?: string;
  destination?: string;
  summary?: string;
  startDate?: string;
  endDate?: string;
  budget?: string;
  fundraisingGoal?: string;
  defaultParticipantGoal?: string;
  participantLimit?: string;
  applicationsOpen?: boolean;
  leadersSeeFinances?: boolean;
};

export function TripForm({
  action,
  defaults = {},
  submitLabel,
  showFinanceToggle,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  defaults?: TripDefaults;
  submitLabel: string;
  showFinanceToggle?: boolean;
}) {
  return (
    <ActionForm action={action} className="space-y-6">
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">The trip</legend>
        <TextField label="Trip name" name="name" defaultValue={defaults.name} placeholder="Guatemala Summer Team" required />
        <TextField label="Destination" name="destination" defaultValue={defaults.destination} placeholder="Antigua, Guatemala" required />
        <TextArea label="Summary" name="summary" defaultValue={defaults.summary} hint="Shown to applicants and on the public trip page. Avoid private details." optional />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Start date" name="startDate" type="date" defaultValue={defaults.startDate} required />
          <TextField label="End date" name="endDate" type="date" defaultValue={defaults.endDate} required />
        </div>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">Money</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <MoneyField label="Total budget" name="budget" defaultValue={defaults.budget ?? "0"} hint="You can break this down by category later." />
          <MoneyField label="Team fundraising goal" name="fundraisingGoal" defaultValue={defaults.fundraisingGoal ?? "0"} />
          <MoneyField label="Goal per participant" name="defaultParticipantGoal" defaultValue={defaults.defaultParticipantGoal ?? "0"} hint="Each new participant's page starts with this goal." />
        </div>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold">Team</legend>
        <TextField label="Participant limit" name="participantLimit" type="number" min={1} defaultValue={defaults.participantLimit} className="sm:max-w-48" optional />
        <CheckboxField label="Accept applications" name="applicationsOpen" defaultChecked={defaults.applicationsOpen} hint="Church members can apply once the trip is open. Leaders approve each application." />
        {showFinanceToggle && (
          <CheckboxField
            label="Trip leaders can see finances"
            name="leadersSeeFinances"
            defaultChecked={defaults.leadersSeeFinances ?? true}
            hint="Lets leaders see trip-wide gifts, fees and expenses, and record expenses. Refunds and reports stay with church admins."
          />
        )}
      </fieldset>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
