"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useId, useRef, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cx } from "./ui";

export type ActionState = { ok: boolean; message?: string; error?: string; fieldErrors?: Record<string, string> } | null;
type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const FormStateContext = createContext<ActionState>(null);
const FormPendingContext = createContext(false);

/**
 * A form bound to a server action. Shows a success or error message, passes
 * field errors to <Field>, and optionally clears itself after success.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  showMessages = true,
  ...rest
}: Omit<ComponentProps<"form">, "action"> & { action: Action; resetOnSuccess?: boolean; showMessages?: boolean }) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <FormStateContext.Provider value={state}>
      <FormPendingContext.Provider value={pending}>
        <form
          ref={ref}
          // Without JavaScript the form still posts to the server action.
          action={formAction}
          // With JavaScript, submit manually so React doesn't clear what the
          // person typed when the server reports a validation error.
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(() => formAction(fd));
          }}
          className={className}
          noValidate
          {...rest}
        >
          {showMessages && <FormMessage />}
          {children}
        </form>
      </FormPendingContext.Provider>
    </FormStateContext.Provider>
  );
}

export function FormMessage() {
  const state = useContext(FormStateContext);
  if (!state) return null;
  if (!state.ok && state.error) {
    return (
      <div role="alert" className="mb-4 rounded-2xl bg-bad-soft px-4 py-3 text-[15px] leading-snug text-bad lg:text-sm">
        {state.error}
      </div>
    );
  }
  if (state.ok && state.message) {
    return (
      <div role="status" className="mb-4 rounded-2xl bg-good-soft px-4 py-3 text-[15px] leading-snug text-good lg:text-sm">
        {state.message}
      </div>
    );
  }
  return null;
}

// iOS-style filled fields: no border, rounded, 44px tall on phones.
const inputClass =
  "block w-full min-h-11 lg:min-h-9 rounded-xl border border-transparent bg-fill px-3.5 py-2.5 lg:py-1.5 text-ink placeholder:text-ink-3 transition-[box-shadow,background-color] focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent focus-visible:outline-none disabled:opacity-60 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-bad file:mr-3 file:rounded-full file:border-0 file:bg-accent-soft file:px-3 file:py-1 file:text-[15px] file:font-semibold file:text-accent-ink";

/** Label + control + hint + error, wired together for screen readers. */
export function Field({
  label,
  name,
  hint,
  children,
  className,
  optional,
}: {
  label: ReactNode;
  name: string;
  hint?: ReactNode;
  children: (props: { id: string; name: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
  className?: string;
  optional?: boolean;
}) {
  const state = useContext(FormStateContext);
  const id = useId();
  const error = state?.fieldErrors?.[name];
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-[15px] font-medium text-ink-2 lg:text-sm">
        {label}
        {optional && <span className="ml-1 font-normal text-ink-3">(optional)</span>}
      </label>
      {children({ id, name, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[13px] leading-snug text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-[13px] leading-snug text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label,
  name,
  hint,
  optional,
  className,
  ...input
}: { label: ReactNode; name: string; hint?: ReactNode; optional?: boolean; className?: string } & Omit<ComponentProps<"input">, "name">) {
  return (
    <Field label={label} name={name} hint={hint} optional={optional} className={className}>
      {(p) => <input {...p} {...input} className={inputClass} />}
    </Field>
  );
}

export function MoneyField(props: { label: ReactNode; name: string; hint?: ReactNode; defaultValue?: string; optional?: boolean; className?: string; required?: boolean }) {
  const { label, name, hint, optional, className, ...rest } = props;
  return (
    <Field label={label} name={name} hint={hint} optional={optional} className={className}>
      {(p) => (
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-ink-3">$</span>
          <input {...p} {...rest} inputMode="decimal" autoComplete="off" className={cx(inputClass, "pl-7 tabular-nums")} />
        </div>
      )}
    </Field>
  );
}

export function TextArea({
  label,
  name,
  hint,
  optional,
  className,
  ...ta
}: { label: ReactNode; name: string; hint?: ReactNode; optional?: boolean; className?: string } & Omit<ComponentProps<"textarea">, "name">) {
  return (
    <Field label={label} name={name} hint={hint} optional={optional} className={className}>
      {(p) => <textarea rows={4} {...p} {...ta} className={inputClass} />}
    </Field>
  );
}

export function SelectField({
  label,
  name,
  hint,
  options,
  className,
  optional,
  ...sel
}: {
  label: ReactNode;
  name: string;
  hint?: ReactNode;
  options: { value: string; label: string }[];
  className?: string;
  optional?: boolean;
} & Omit<ComponentProps<"select">, "name">) {
  return (
    <Field label={label} name={name} hint={hint} optional={optional} className={className}>
      {(p) => (
        <div className="relative">
          <select {...p} {...sel} className={cx(inputClass, "appearance-none pr-9")}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <svg aria-hidden width="12" height="8" viewBox="0 0 12 8" className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-ink-3">
            <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </Field>
  );
}

export function CheckboxField({ label, name, hint, defaultChecked }: { label: ReactNode; name: string; hint?: ReactNode; defaultChecked?: boolean }) {
  const id = useId();
  return (
    // An iOS-style switch row: label on the left, switch on the right.
    <div className="flex items-center justify-between gap-4 rounded-xl bg-fill px-3.5 py-2.5">
      <div className="min-w-0">
        <label htmlFor={id} className="block font-medium">
          {label}
        </label>
        {hint && <p className="text-[13px] leading-snug text-ink-3">{hint}</p>}
      </div>
      <input id={id} type="checkbox" name={name} defaultChecked={defaultChecked} className="switch" />
    </div>
  );
}

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  className,
  confirm,
  ...rest
}: { children: ReactNode; pendingText?: string; variant?: "primary" | "secondary" | "ghost" | "danger"; className?: string; confirm?: string } & Omit<ComponentProps<"button">, "type">) {
  const status = useFormStatus();
  const actionPending = useContext(FormPendingContext);
  const pending = status.pending || actionPending;
  return (
    <button
      type="submit"
      disabled={pending || rest.disabled}
      aria-disabled={pending}
      className={buttonClass(variant, className)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      {...rest}
    >
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

/** A one-button form (approve, delete, publish) with an optional confirmation prompt. */
export function ActionButton({
  action,
  fields,
  children,
  variant = "secondary",
  confirm,
  pendingText,
  className,
}: {
  action: Action;
  fields?: Record<string, string>;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  confirm?: string;
  pendingText?: string;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={cx("inline-flex flex-col items-start", className)}>
      {Object.entries(fields ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant} confirm={confirm} pendingText={pendingText ?? "Working…"}>
        {children}
      </SubmitButton>
      {state && !state.ok && state.error && (
        <span role="alert" className="mt-1 text-[13px] text-bad">
          {state.error}
        </span>
      )}
    </form>
  );
}
