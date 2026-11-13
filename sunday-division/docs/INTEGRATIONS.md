# INDEX V3 and FORM — integration contract

Sunday Division consumes two independent products through one small, job-based HTTP contract:

| Product | Role | Job types |
|---|---|---|
| **INDEX V3** | Garment engineering | `technical_flats`, `tech_pack`, `measurement_spec`, `garment_3d` |
| **FORM** | Creative production | `product_imagery`, `campaign_assets` |

The studio side is implemented in `src/integrations/index.js`. Each product is switched on by setting its URL and key (`INDEX_V3_API_URL` / `INDEX_V3_API_KEY`, `FORM_API_URL` / `FORM_API_KEY`). Until then the adapter runs in **manual mode**: a request becomes a task for a human designer and nothing else changes.

Two rules hold in both modes:

1. Production can only be requested after the project's deposit is received.
2. Outputs arrive as deliverables **in review**. A person approves and releases them. A passing `validation` result from INDEX V3 is shown to the reviewer; it never skips review.

## Authentication

`Authorization: Bearer <api key>` on every request, over HTTPS. Keys are per environment and held only in server configuration.

## Endpoints the product must provide

### `POST /v1/files` — upload an input file

Request body is the raw file bytes.

| Header | Meaning |
|---|---|
| `Content-Type` | Media type of the file (`image/png`, `application/pdf`, …) |
| `X-Filename` | URL-encoded original filename |
| `X-Content-SHA256` | Hex SHA-256 of the body, for integrity |

Response `201`: `{ "id": "file_123" }`

### `POST /v1/jobs` — submit a job

Header `Idempotency-Key` — `sd-wf<workflow>:<product>:<job_type>` when submitted by an agent, `sd-job-<n>` when submitted by staff. A repeated key must return the original job, not create a second one.

```json
{
  "job_type": "tech_pack",
  "client_reference": "SD-P0001",
  "brief": "Approved project brief as plain text, or empty",
  "garment": {
    "category": "Outerwear",
    "description": "Client's description of the garment",
    "target_measurements": "Free text: size range, base size, key measurements",
    "fabric_preferences": "Free text"
  },
  "notes": "Free-text instructions from the studio",
  "input_file_ids": ["file_123"]
}
```

No client contact details are ever included. `client_reference` is the studio's project code.

Response `202`: `{ "id": "job_42", "status": "queued" }`

### `GET /v1/jobs/{id}` — job status

```json
{
  "id": "job_42",
  "status": "queued | running | completed | failed",
  "error": "Present when failed",
  "validation": {
    "status": "passed | failed | not_run",
    "checks": [{ "name": "seam_allowance_consistency", "status": "passed", "detail": "" }]
  },
  "outputs": [
    { "id": "out_1", "filename": "tech-pack.pdf", "content_type": "application/pdf", "bytes": 482113, "sha256": "…" }
  ]
}
```

`validation` is INDEX V3's own verdict on the generated garment data; FORM may omit it.

### `GET /v1/jobs/{id}/outputs/{output_id}` — download an output

Returns the file bytes with its `Content-Type`.

### Versioning

Return the service build in an `X-Service-Version` response header (for example `index-v3.0.4`). It is stored on the job and shown next to each output, so every deliverable can be traced to the exact version that produced it.

## Behaviour on the studio side

- **Submit**: reference files are uploaded, then the job is created and recorded with status `queued`.
- **Autonomy**: agents submit jobs only when *Autonomous production* is switched on in Operations → Controls, the service is connected, and the project's external budget allows. Otherwise the request goes to the human production queue.
- **Poll**: the coordinator agent polls with backoff (1 → 30 minutes, up to 24 hours); staff can also press *Check status*. On `completed`, each output is downloaded, stored privately and attached to a new deliverable with `source = index_v3 | form`, status `in_review`, and a note recording the job id and validation status.
- **Failure**: a `failed` job or a non-2xx response is recorded on the job and shown in the dashboard; nothing reaches the client.

## Planned, not yet built

- Webhook callback (`POST {BASE_URL}/webhooks/integrations/{product}`, HMAC-signed like Stripe's) to replace manual polling.
- Structured garment inputs (graded measurement tables, BOM lines) in place of free text, once INDEX V3's input schema is stable.
- `POST /v1/jobs/{id}/cancel`.

The contract is exercised end to end in `tests/integrations.test.js` against a mock server.
