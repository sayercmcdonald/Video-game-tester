"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, SelectField, SubmitButton, TextArea, TextField, type ActionState } from "./forms";

const KIND_HELP: Record<string, string> = {
  UPLOAD: "Participants upload a file, like a passport copy or signed medical form.",
  WAIVER: "Participants read your text and sign by typing their full name. The signature is recorded with a timestamp.",
  FORM: "Participants answer your questions. Answers are visible only to leaders and church admins.",
  TASK: "Participants mark something done, like attending orientation.",
};

export function RequirementForm({ action }: { action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [kind, setKind] = useState("UPLOAD");
  return (
    <ActionForm action={action} resetOnSuccess className="space-y-4">
      <SelectField
        label="Type"
        name="kind"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        hint={KIND_HELP[kind]}
        options={[
          { value: "UPLOAD", label: "File upload" },
          { value: "WAIVER", label: "Signed waiver" },
          { value: "FORM", label: "Questions (form)" },
          { value: "TASK", label: "Task" },
        ]}
      />
      <TextField label="Title" name="title" placeholder={kind === "UPLOAD" ? "Passport copy" : kind === "WAIVER" ? "Participation waiver" : kind === "FORM" ? "Health & dietary form" : "Attend orientation"} required />
      <TextArea label="Instructions" name="instructions" rows={3} optional />
      {kind === "WAIVER" && <TextArea label="Waiver text" name="waiverText" rows={8} hint="Use the wording your church's counsel has approved." required />}
      {kind === "FORM" && (
        <TextArea
          label="Questions"
          name="formQuestions"
          rows={5}
          hint='One question per line. Add "(optional)" to make it optional, or "[yes/no]" for a yes/no answer.'
          placeholder={"Do you have any food allergies? [yes/no]\nPlease describe them (optional)"}
          required
        />
      )}
      {kind === "UPLOAD" && (
        <TextField label="Blank form to download" name="template" type="file" hint="Optional: a PDF participants fill out and upload back." optional />
      )}
      <TextField label="Due date" name="dueDate" type="date" className="sm:max-w-56" optional />
      <CheckboxField label="Required to be ready for the trip" name="isRequired" defaultChecked />
      <CheckboxField
        key={kind}
        label="A leader reviews each submission"
        name="needsReview"
        defaultChecked={kind === "UPLOAD" || kind === "FORM"}
        hint="If unchecked, completing it is enough."
      />
      <SubmitButton>Add requirement</SubmitButton>
    </ActionForm>
  );
}
