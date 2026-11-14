'use strict';
/**
 * Versioned asset URLs (cache busting).
 *
 * Pages link stylesheets, scripts and images as /assets/<file>?v=<content hash>. A new deploy
 * changes the hash of every file whose content changed, so browsers — and the Command service
 * worker, which matches its cache on the full URL — fetch the new file instead of mixing an old
 * cached stylesheet with new markup. Requests that carry the current hash may be cached for a
 * year (see serveStatic); anything else is revalidated.
 *
 * Hashes follow the file on disk (size + mtime are checked on each call), so editing a file in
 * development changes its URL without a restart.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const cache = new Map(); // rel → { key, hash }

/** Short content hash of public/<rel>, or '' when the file does not exist. */
function hashOf(rel, dir = PUBLIC_DIR) {
  const file = path.join(dir, rel);
  let stat;
  try { stat = fs.statSync(file); } catch { return ''; }
  const id = `${dir}:${rel}`;
  const key = `${stat.size}:${stat.mtimeMs}`;
  const hit = cache.get(id);
  if (hit && hit.key === key) return hit.hash;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
  cache.set(id, { key, hash });
  return hash;
}

/** '/assets/css/site.css' or 'css/site.css' → '/assets/css/site.css?v=<hash>'. */
function assetUrl(p, dir = PUBLIC_DIR) {
  const rel = p.replace(/^\/?assets\//, '').replace(/^\//, '');
  const hash = hashOf(rel, dir);
  return hash ? `/assets/${rel}?v=${hash}` : `/assets/${rel}`;
}

module.exports = { assetUrl, hashOf, PUBLIC_DIR };
