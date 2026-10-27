"use client";

import { useState } from "react";
import { ActionForm, CheckboxField, SubmitButton, TextArea, TextField, type ActionState } from "./forms";
import { cx } from "./ui";

const PRESETS = ["25", "50", "100", "250", "500"];

export function DonateForm({ action, defaultName, defaultEmail }: { action: (p: ActionState, fd: FormData) => Promise<ActionState>; defaultName?: string; defaultEmail?: string }) {
  const [amount, setAmount] = useState("100");
  return (
    <ActionForm action={action} className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Gift amount</legend>
        <div className="grid grid-cols-3 gap-2">
          {[...PRESETS, "other"].map((v) => (
            <label
              key={v}
              className={cx(
                "flex h-12 cursor-pointer items-center justify-center rounded-xl text-[17px] font-semibold tabular-nums transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                amount === v ? "bg-accent text-on-accent" : "bg-fill text-ink hover:brightness-95",
              )}
            >
              <input type="radio" name="amount" value={v} checked={amount === v} onChange={() => setAmount(v)} className="sr-only" />
              {v === "other" ? "Other" : `$${v}`}
            </label>
          ))}
        </div>
        {amount === "other" && (
          <div className="mt-3">
            <TextField label="Amount (USD)" name="otherAmount" inputMode="decimal" placeholder="75.00" hint="Minimum $5." autoFocus required />
          </div>
        )}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Your name" name="donorName" autoComplete="name" defaultValue={defaultName} required />
        <TextField label="Email for your receipt" name="donorEmail" type="email" autoComplete="email" defaultValue={defaultEmail} required />
      </div>
      <TextArea label="Message of encouragement" name="message" rows={2} hint="Shown on this page with your first name." optional />
      <CheckboxField label="Give anonymously" name="isAnonymous" hint="Your name won't appear publicly. The church and participant still see it for receipts and thank-yous." />
      <SubmitButton className="h-12 w-full lg:h-12 lg:text-[17px]" pendingText="Opening secure checkout…">
        Continue to secure payment
      </SubmitButton>
      <p className="text-center text-xs text-ink-3">Payments are processed by Stripe. Card details go directly to Stripe and are never stored by us or the church.</p>
    </ActionForm>
  );
}
