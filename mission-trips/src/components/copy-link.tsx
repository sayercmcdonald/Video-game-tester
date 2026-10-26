"use client";

import { useState } from "react";
import { buttonClass } from "./ui";

export function CopyLink({ url, label = "Copy link" }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex w-full max-w-full items-stretch gap-2">
      <input readOnly value={url} aria-label="Link" onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-md border border-line-strong bg-subtle px-3 text-sm text-ink-2" />
      <button
        type="button"
        className={buttonClass("secondary")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            /* clipboard unavailable: the field is selectable as a fallback */
          }
        }}
      >
        <span aria-live="polite">{copied ? "Copied" : label}</span>
      </button>
    </div>
  );
}
