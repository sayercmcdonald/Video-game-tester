import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AppError } from "./errors";

export type ActionState = {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
} | null;

/**
 * Wraps a server action so validation and permission errors become friendly
 * messages, and unexpected errors are logged without leaking details.
 */
export function formAction(fn: (formData: FormData) => Promise<ActionState | void>) {
  return async (_prev: ActionState, formData: FormData): Promise<ActionState> => {
    try {
      return (await fn(formData)) ?? { ok: true };
    } catch (err) {
      unstable_rethrow(err); // let redirect() and notFound() through
      return toActionError(err);
    }
  };
}

export function toActionError(err: unknown): ActionState {
  if (err instanceof AppError) return { ok: false, error: err.message };
  if (err instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  console.error("[action] unexpected error", err);
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** Converts FormData into a plain object for zod parsing. Empty strings become undefined. */
export function formObject(formData: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    const v = value.trim();
    out[key] = v === "" ? undefined : v;
  }
  return out;
}

/** Runs action logic with the same friendly error handling, for actions with bound arguments. */
export async function run(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    return toActionError(err);
  }
}
