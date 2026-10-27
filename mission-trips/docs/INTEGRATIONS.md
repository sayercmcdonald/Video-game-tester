# Integrations

_Last updated: 2026-10-27_

Sent is designed to sit alongside a church's existing software. This document records what each integration can actually do today, based on published documentation, and how the integration layer works.

## Status

| Provider | Status | What we verified | Plan |
| --- | --- | --- | --- |
| **CSV export** | **Available** | Built and tested: gifts, expenses, ledger, per church or per trip; spreadsheet-formula injection protection; every export logged. | Done. |
| **Planning Center** | Planned | Public REST API (JSON:API), developer access via personal access token or OAuth; Giving API writable since 2017 (Planning Center blog). A third-party integrator reports a 70 requests / 20 s rate limit (unverified). Competitors ManagedMissions and Go Method integrate with it. | First live integration: push received trip gifts to Planning Center Giving (Sent owns them) and match people by email (Planning Center owns people). Needs a real Planning Center account to build and test. |
| **QuickBooks Online** | Planned | Public API with OAuth; requires registering an app with Intuit. | After Planning Center, if pilot churches use QuickBooks; CSV covers it meanwhile. |
| **Tithely** | Needs partner access | No public self-serve developer API found. Tithely integrates via partnerships (e.g., Focus Missions for trips) and pushes giving to ChMS such as Breeze using the ChMS's API. | Contact Tithely partnerships if pilot churches use Tithely. |
| **Subsplash** | Needs partner access | No official public developer portal found; third-party sources say API access is provisioned on certain paid plans by Subsplash staff. | Contact Subsplash if pilot churches use it. |

We will **not** build scraping or undocumented integrations.

## Architecture (`src/server/integrations/`)

- **Registry** (`registry.ts`): the catalog shown on Settings → Integrations, with truthful availability. A test fails if anything except CSV is marked available.
- **Credentials** (`links.ts`): stored per church and provider in `Integration.credentialsEncrypted` (AES-256-GCM, same key as medical data), never returned to the browser; saving is audit-logged.
- **Record links** (`ExternalLink`): maps a Sent record to its counterpart elsewhere, with a declared owner (`SENT` or `EXTERNAL`). Unique per church/provider/type/external ID, so a re-sync updates instead of duplicating; a conflicting link is refused.
- **Sync runs** (`SyncRun`): every import/export records direction, kind, counts, status and error, shown under "Recent exports and syncs" and logged in the activity log.
- **Webhooks**: provider webhooks should follow the Stripe pattern already in place: verify the signature, store the event ID for de-duplication, process idempotently, return 500 to trigger the provider's retry on failure.
- **Retries and visibility**: failed runs keep their error; the platform admin page will surface failed syncs like failed Stripe events.

## Adding an adapter (checklist)

1. Read the provider's current API docs: auth, rate limits, webhooks, pricing/terms. Record findings here.
2. Define the data mapping and owner for each record type.
3. Implement against a real sandbox/test account; never fake responses in the app.
4. Use `linkExternal` for every synced record; create a `SyncRun` per run.
5. Tests: mapping, duplicate prevention, retry after failure, tenant isolation.
6. Only then mark it `available` in the registry.
