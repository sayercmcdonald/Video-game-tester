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
      <div role="alert" className="mb-4 rounded-md border border-transparent bg-bad-soft px-3 py-2 text-sm text-bad">
        {state.error}
      </div>
    );
  }
  if (state.ok && state.message) {
    return (
      <div role="status" className="mb-4 rounded-md bg-good-soft px-3 py-2 text-sm text-good">
        {state.message}
      </div>
    );
  }
  return null;
}

const inputClass =
  "block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[15px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-subtle aria-[invalid=true]:border-bad";

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
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {optional && <span className="ml-1 font-normal text-ink-3">(optional)</span>}
      </label>
      {children({ id, name, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-ink-3">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-sm text-bad">
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
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-3">$</span>
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
        <select {...p} {...sel} className={inputClass}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function CheckboxField({ label, name, hint, defaultChecked }: { label: ReactNode; name: string; hint?: ReactNode; defaultChecked?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input id={id} type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 rounded border-line-strong accent-[var(--color-accent)]" />
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && <p className="text-sm text-ink-3">{hint}</p>}
      </div>
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
        <span role="alert" className="mt-1 text-xs text-bad">
          {state.error}
        </span>
      )}
    </form>
  );
}
