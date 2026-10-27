"use client";

import { useFormStatus } from "react-dom";
import { Chevron } from "./ui";

/** Shows "Signing in…" on the tapped demo account while the server works. */
export function DemoPending() {
  const { pending } = useFormStatus();
  return pending ? <span className="shrink-0 text-sm text-accent">Signing in…</span> : <Chevron />;
}
