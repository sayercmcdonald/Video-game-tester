'use strict';
const { HttpError } = require('../lib/util');

/** Buffer the request body, refusing anything larger than `limit` bytes. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) {
      req.resume();
      return reject(new HttpError(413, 'Upload too large.'));
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        return reject(new HttpError(413, 'Upload too large.'));
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function addField(target, name, value) {
  if (name in target) target[name] = [].concat(target[name], value);
  else target[name] = value;
}

function parseUrlEncoded(buf) {
  const fields = Object.create(null);
  for (const [k, v] of new URLSearchParams(buf.toString('utf8'))) addField(fields, k, v);
  return fields;
}

/**
 * Minimal multipart/form-data parser for fully buffered bodies.
 * Returns { fields, files: [{ field, filename, contentType, data }] }.
 */
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) throw new HttpError(400, 'Malformed form submission.');
  const delim = Buffer.from('--' + (m[1] || m[2]).trim());
  const fields = Object.create(null);
  const files = [];
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    let start = pos + delim.length;
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break; // closing "--"
    start += 2; // CRLF after the delimiter
    const next = buf.indexOf(delim, start);
    if (next === -1) break;
    const part = buf.subarray(start, next - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) throw new HttpError(400, 'Malformed form submission.');
    const headers = part.subarray(0, headerEnd).toString('utf8');
    const data = part.subarray(headerEnd + 4);
    const name = /content-disposition:[^\r\n]*?[; ]name="([^"]*)"/i.exec(headers);
    if (name) {
      const filename = /content-disposition:[^\r\n]*?filename="([^"]*)"/i.exec(headers);
      if (filename) {
        const type = /content-type:\s*([^\r\n;]+)/i.exec(headers);
        if (filename[1] || data.length) {
          files.push({
            field: name[1],
            filename: filename[1],
            contentType: type ? type[1].trim().toLowerCase() : 'application/octet-stream',
            data: Buffer.from(data),
          });
        }
      } else {
        addField(fields, name[1], data.toString('utf8'));
      }
    }
    pos = next;
  }
  return { fields, files };
}

async function parseRequestBody(req, limit) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  const buf = await readBody(req, limit);
  if (type.startsWith('multipart/form-data')) {
    return parseMultipart(buf, String(req.headers['content-type']));
  }
  if (type.startsWith('application/x-www-form-urlencoded')) {
    return { fields: parseUrlEncoded(buf), files: [] };
  }
  if (!buf.length) return { fields: Object.create(null), files: [] };
  throw new HttpError(415, 'Unsupported content type.');
}

module.exports = { readBody, parseRequestBody, parseMultipart };
