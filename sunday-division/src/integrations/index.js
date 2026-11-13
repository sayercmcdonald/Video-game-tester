'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { now, str, safeJson, HttpError } = require('../lib/util');

/**
 * Adapters for the two independent products Sunday Division will consume:
 *   INDEX V3 — garment engineering (flats, tech packs, measurement specs, 3D garments)
 *   FORM     — creative production (product imagery, campaign assets)
 *
 * Both speak the same small job-based HTTP contract (docs/INTEGRATIONS.md). Until a product
 * is configured, the adapter runs in MANUAL mode: a request becomes a task for a human
 * designer, so the studio can launch without either integration.
 *
 * Whatever the mode, outputs land as deliverables "in review". A person must approve and
 * release them — generated files never reach a client directly.
 */
const PRODUCTS = {
  index_v3: {
    name: 'INDEX V3',
    jobTypes: {
      technical_flats: { label: 'Technical flats', deliverableType: 'flats' },
      tech_pack: { label: 'Tech pack', deliverableType: 'techpack' },
      measurement_spec: { label: 'Measurement specification', deliverableType: 'techpack' },
      garment_3d: { label: '3D garment', deliverableType: '3d' },
    },
  },
  form: {
    name: 'FORM',
    jobTypes: {
      product_imagery: { label: 'Product imagery', deliverableType: 'imagery' },
      campaign_assets: { label: 'Campaign assets', deliverableType: 'campaign' },
    },
  },
};

function createIntegrations(app) {
  const { db, config } = app;
  const settings = (product) => config.integrations[product];
  const isConnected = (product) => Boolean(settings(product).baseUrl && settings(product).apiKey);

  async function call(product, method, pathname, { json, body, headers = {} } = {}) {
    const { baseUrl, apiKey } = settings(product);
    const res = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json ? JSON.stringify(json) : body,
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new HttpError(502, `${PRODUCTS[product].name} returned ${res.status}.`);
    return res;
  }

  function hydrate(job) {
    if (job) { job.request = safeJson(job.request, {}); job.result = safeJson(job.result, null); }
    return job;
  }

  function buildRequest(project, jobType, notes) {
    const inquiry = project.inquiry_id ? app.intake.get(project.inquiry_id) : null;
    return {
      job_type: jobType,
      client_reference: project.code,
      brief: project.brief_status === 'approved' ? project.brief : '',
      garment: inquiry ? {
        category: inquiry.garment_category, description: inquiry.description,
        target_measurements: inquiry.measurements, fabric_preferences: inquiry.fabric_preferences,
      } : {},
      notes: str(notes, 2000),
      input_file_ids: [],
    };
  }

  return {
    PRODUCTS,
    isConnected,
    status: () => Object.keys(PRODUCTS).map((id) => ({ id, name: PRODUCTS[id].name, connected: isConnected(id), jobTypes: PRODUCTS[id].jobTypes })),
    jobs: (projectId) => db.all('SELECT * FROM integration_jobs WHERE project_id = ? ORDER BY id DESC', projectId).map(hydrate),

    /** Request a piece of production work from INDEX V3 / FORM, or from a human when not connected. */
    async request(project, product, jobType, notes, actor) {
      const spec = PRODUCTS[product] && PRODUCTS[product].jobTypes[jobType];
      if (!spec) throw new HttpError(400, 'Unknown production request.');
      app.projects.requireWorkUnlocked(project);
      const request = buildRequest(project, jobType, notes);

      if (!isConnected(product)) {
        const id = db.tx(() => {
          const jobId = db.insert('integration_jobs', {
            project_id: project.id, product, mode: 'manual', job_type: jobType, status: 'needs_human',
            request: JSON.stringify(request), created_at: now(), updated_at: now(),
          });
          app.projects.addTask(project.id, { title: `${spec.label} — manual production (${PRODUCTS[product].name} not connected)`, milestone: 'Production' }, { source: 'integration' });
          return jobId;
        });
        app.audit.log(actor, 'integration.manual_requested', { entity: 'integration_job', entityId: id, projectId: project.id, detail: `${product}/${jobType}` });
        return id;
      }

      // API mode: upload reference files, then submit the job.
      const uploadsDir = path.join(config.dataDir, 'uploads');
      for (const file of app.files.forProject(project.id).filter((f) => f.kind === 'reference')) {
        const res = await call(product, 'POST', '/v1/files', {
          body: fs.readFileSync(path.join(uploadsDir, file.storage_name)),
          headers: { 'Content-Type': file.mime, 'X-Filename': encodeURIComponent(file.original_name), 'X-Content-SHA256': file.sha256 },
        });
        request.input_file_ids.push((await res.json()).id);
      }
      const id = db.insert('integration_jobs', {
        project_id: project.id, product, mode: 'api', job_type: jobType, status: 'queued',
        request: JSON.stringify(request), created_at: now(), updated_at: now(),
      });
      try {
        const res = await call(product, 'POST', '/v1/jobs', { json: request, headers: { 'Idempotency-Key': `sd-job-${id}` } });
        const remote = await res.json();
        db.update('integration_jobs', id, { external_id: String(remote.id), status: remote.status === 'running' ? 'running' : 'queued', updated_at: now() });
      } catch (err) {
        db.update('integration_jobs', id, { status: 'failed', result: JSON.stringify({ error: err.message }), updated_at: now() });
        throw err;
      }
      app.audit.log(actor, 'integration.job_submitted', { entity: 'integration_job', entityId: id, projectId: project.id, detail: `${product}/${jobType}` });
      return id;
    },

    /** Poll an API job; on completion, import its outputs as deliverables awaiting human review. */
    async refresh(jobId, actor) {
      const job = hydrate(db.get('SELECT * FROM integration_jobs WHERE id = ?', jobId));
      if (!job) throw new HttpError(404, 'Job not found.');
      if (job.mode !== 'api' || !['queued', 'running'].includes(job.status)) return job;
      const remote = await (await call(job.product, 'GET', `/v1/jobs/${encodeURIComponent(job.external_id)}`)).json();
      if (remote.status === 'failed') {
        db.update('integration_jobs', job.id, { status: 'failed', result: JSON.stringify({ error: remote.error || 'failed' }), updated_at: now() });
      } else if (remote.status === 'completed') {
        const spec = PRODUCTS[job.product].jobTypes[job.job_type];
        const downloaded = [];
        for (const output of (remote.outputs || []).slice(0, 20)) {
          const res = await call(job.product, 'GET', `/v1/jobs/${encodeURIComponent(job.external_id)}/outputs/${encodeURIComponent(output.id)}`);
          downloaded.push({ output, data: Buffer.from(await res.arrayBuffer()) });
        }
        db.tx(() => {
          for (const { output, data } of downloaded) {
            const fileId = app.files.storeGenerated(data, output.filename || `${job.job_type}.bin`, { projectId: job.project_id, kind: 'deliverable', uploadedBy: job.product });
            const deliverableId = app.projects.addDeliverable(job.project_id, {
              title: `${spec.label} — ${output.filename || output.id}`, type: spec.deliverableType,
              notes: `Generated by ${PRODUCTS[job.product].name} (job ${job.external_id}). Validation: ${(remote.validation && remote.validation.status) || 'not reported'}. Requires technical review.`,
            }, { source: job.product, actor });
            app.projects.attachDeliverableFile(deliverableId, fileId, actor);
          }
          db.update('integration_jobs', job.id, {
            status: 'completed', updated_at: now(),
            result: JSON.stringify({ validation: remote.validation || null, outputs: (remote.outputs || []).map((o) => ({ id: o.id, filename: o.filename })) }),
          });
        });
      } else {
        db.update('integration_jobs', job.id, { status: remote.status === 'running' ? 'running' : 'queued', updated_at: now() });
      }
      return hydrate(db.get('SELECT * FROM integration_jobs WHERE id = ?', jobId));
    },

    /** Close a manual request once a person has produced the work. */
    completeManual(jobId, actor) {
      const job = db.get('SELECT * FROM integration_jobs WHERE id = ?', jobId);
      if (!job || job.mode !== 'manual') throw new HttpError(404, 'Job not found.');
      db.update('integration_jobs', jobId, { status: 'completed', updated_at: now() });
      app.audit.log(actor, 'integration.manual_completed', { entity: 'integration_job', entityId: jobId, projectId: job.project_id });
      return job.project_id;
    },
  };
}

module.exports = { createIntegrations, PRODUCTS };
