import type { IntegrationProvider } from "@/generated/prisma/client";

// The integrations catalog. Each entry states what is actually true today,
// based on the provider's published documentation (checked 2026-10-27; see
// docs/INTEGRATIONS.md). Nothing is shown as connectable unless it works.

export type IntegrationAvailability =
  | "available" // works now
  | "planned" // public API documented; adapter not built or not yet verified against a live account
  | "partner_access" // no self-serve public API found; requires the provider's partner program or sales
  | "not_planned";

export type ProviderInfo = {
  provider: IntegrationProvider;
  name: string;
  availability: IntegrationAvailability;
  summary: string;
  /** What Sent would exchange, and which system owns each record. */
  dataFlow: string;
  docsUrl?: string;
  notes: string;
};

export const PROVIDERS: ProviderInfo[] = [
  {
    provider: "CSV_EXPORT",
    name: "Spreadsheet export (CSV)",
    availability: "available",
    summary: "Download gifts, expenses and the full ledger for your bookkeeper, accounting software or church management system.",
    dataFlow: "Sent → file. Sent remains the source of truth for trip records.",
    notes: "Works with QuickBooks, Aplos, Excel, Google Sheets and most church management systems' import tools.",
  },
  {
    provider: "PLANNING_CENTER",
    name: "Planning Center",
    availability: "planned",
    summary: "Send gifts received in Sent to Planning Center Giving so they appear in donor giving statements, and match people by email.",
    dataFlow: "Sent → Planning Center Giving (Sent owns trip gifts); Planning Center People → Sent for matching (Planning Center owns people).",
    docsUrl: "https://developer.planning.center/docs",
    notes: "Public REST API (JSON:API) with personal access tokens or OAuth; Giving is writable. Not yet built: needs testing against a real Planning Center account before release.",
  },
  {
    provider: "TITHELY",
    name: "Tithely",
    availability: "partner_access",
    summary: "Bring Tithely gifts designated for a trip into Sent, or send Sent gifts to Tithely.",
    dataFlow: "To be decided with Tithely.",
    notes: "We found no public, self-serve developer API. Tithely integrates with other systems through partnerships. Until then, use the CSV export.",
  },
  {
    provider: "SUBSPLASH",
    name: "Subsplash",
    availability: "partner_access",
    summary: "Exchange giving and people records with Subsplash.",
    dataFlow: "To be decided with Subsplash.",
    notes: "Third-party sources indicate API access is provisioned by Subsplash on certain plans rather than self-serve. Until then, use the CSV export.",
  },
  {
    provider: "QUICKBOOKS",
    name: "QuickBooks Online",
    availability: "planned",
    summary: "Post trip income and expenses to QuickBooks with your church's chart of accounts.",
    dataFlow: "Sent → QuickBooks journal entries (QuickBooks owns the books).",
    docsUrl: "https://developer.intuit.com/app/developer/qbo/docs/get-started",
    notes: "Public API with OAuth; requires registering an app with Intuit and mapping categories to accounts. CSV export covers this today.",
  },
];

export function providerInfo(p: IntegrationProvider) {
  return PROVIDERS.find((x) => x.provider === p)!;
}
