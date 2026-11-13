'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { token, sha256 } = require('../lib/crypto');
const { now, HttpError, str } = require('../lib/util');

/** File signatures for the types clients may upload. Extension and declared type are not trusted. */
const SIGNATURES = [
  { mime: 'image/jpeg', ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: '.png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: '.webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'application/pdf', ext: '.pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
];
const INLINE_IMAGE = new Set(['image/jpeg', 'image/png', 'image/webp']);

function sniff(buf) {
  return SIGNATURES.find((s) => buf.length > 12 && s.test(buf)) || null;
}

function cleanName(name) {
  const base = path.basename(String(name || 'file').replace(/\\/g, '/'));
  return base.replace(/[^\w.\- ()]+/g, '_').slice(0, 120) || 'file';
}

function createFiles({ db, config }) {
  const dir = path.join(config.dataDir, 'uploads');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  function store({ data, filename, mime, kind, inquiryId = null, projectId = null, uploadedBy, label = '' }) {
    // Stored under a random name outside the web root; never served statically.
    const storageName = token(24);
    fs.writeFileSync(path.join(dir, storageName), data, { mode: 0o600, flag: 'wx' });
    return db.insert('files', {
      inquiry_id: inquiryId, project_id: projectId, kind, label: str(label, 120),
      storage_name: storageName, original_name: cleanName(filename), mime,
      size: data.length, sha256: sha256(data), uploaded_by: uploadedBy, created_at: now(),
    });
  }

  return {
    sniff,
    /** Client-supplied upload: images and PDFs only, verified by content. */
    storeClientUpload(upload, target) {
      if (upload.data.length > config.limits.intakeFileBytes) {
        throw new HttpError(413, `"${cleanName(upload.filename)}" is larger than 8 MB.`);
      }
      const type = sniff(upload.data);
      if (!type) throw new HttpError(400, `"${cleanName(upload.filename)}" is not a JPG, PNG, WebP or PDF file.`);
      return store({ ...target, data: upload.data, filename: upload.filename, mime: type.mime, kind: 'reference' });
    },
    /** Staff upload: any type, always downloaded as an attachment unless a verified image. */
    storeStaffUpload(upload, target) {
      const type = sniff(upload.data);
      return store({ ...target, data: upload.data, filename: upload.filename, mime: type ? type.mime : 'application/octet-stream' });
    },
    /** Bytes produced by an integration (INDEX V3 / FORM). */
    storeGenerated: (data, filename, target) => {
      const type = sniff(data);
      return store({ ...target, data, filename, mime: type ? type.mime : 'application/octet-stream' });
    },
    get: (id) => db.get('SELECT * FROM files WHERE id = ?', id),
    forInquiry: (id) => db.all('SELECT * FROM files WHERE inquiry_id = ? ORDER BY id', id),
    forProject: (id) => db.all('SELECT * FROM files WHERE project_id = ? ORDER BY kind, id', id),
    /**
     * Automation: give every project file a consistent, sortable label
     * (e.g. "SD-P0003 · Reference 02"). Internal only — nothing is sent anywhere.
     */
    organize(project) {
      const counters = {};
      const names = { reference: 'Reference', working: 'Working file', deliverable: 'Deliverable' };
      let changed = 0;
      for (const f of db.all('SELECT * FROM files WHERE project_id = ? ORDER BY kind, id', project.id)) {
        counters[f.kind] = (counters[f.kind] || 0) + 1;
        const label = `${project.code} · ${names[f.kind]} ${String(counters[f.kind]).padStart(2, '0')}`;
        if (f.label !== label) { db.update('files', f.id, { label }); changed += 1; }
      }
      return changed;
    },
    /** Stream a stored file. Authorisation is the caller's job. */
    send(ctx, file, { inline = false } = {}) {
      const full = path.join(dir, file.storage_name);
      if (!fs.existsSync(full)) throw new HttpError(404, 'File not found.');
      const asInline = inline && INLINE_IMAGE.has(file.mime);
      const safe = file.original_name.replace(/["\\\r\n]/g, '_');
      ctx.res.writeHead(200, {
        'Content-Type': asInline ? file.mime : 'application/octet-stream',
        'Content-Length': file.size,
        'Content-Disposition': `${asInline ? 'inline' : 'attachment'}; filename="${safe}"`,
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      fs.createReadStream(full).pipe(ctx.res);
    },
    isInlineImage: (file) => INLINE_IMAGE.has(file.mime),
    pathOf: (file) => path.join(dir, file.storage_name),
  };
}

module.exports = { createFiles };
