'use strict';
/**
 * Runs in a separate Node process with the permission model enabled: it can read only the
 * one file it was given, cannot write, spawn processes or load add-ons, and has an empty
 * environment (no credentials). It inspects bytes; nothing in the file is executed.
 */
const fs = require('node:fs');
const crypto = require('node:crypto');

const MAX = 60 * 1024 * 1024;
function inspect(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const buf = Buffer.alloc(Math.min(size, MAX));
  fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  const out = { size, truncated: size > MAX, sha256: crypto.createHash('sha256').update(buf).digest('hex'), type: 'unknown' };
  const head = buf.subarray(0, 16);
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') {
    out.type = 'pdf';
    const text = buf.toString('latin1');
    out.pdf = {
      pages: (text.match(/\/Type\s*\/Page(?![s\w])/g) || []).length,
      encrypted: /\/Encrypt\b/.test(text),
      active_content: /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b/.test(text),
    };
  } else if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    out.type = 'png';
    out.image = { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } else if (head[0] === 0xff && head[1] === 0xd8) {
    out.type = 'jpeg';
    out.image = jpegSize(buf);
  } else if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') {
    out.type = 'webp';
    out.image = webpSize(buf);
  } else if (head.subarray(0, 4).toString('latin1') === 'glTF') {
    out.type = 'glb';
  } else if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    out.type = 'zip';
  }
  return out;
}
function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return { width: 0, height: 0 };
}
function webpSize(b) {
  const chunk = b.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  return { width: 0, height: 0 };
}

try {
  process.send({ ok: true, report: inspect(process.argv[2]) });
} catch (err) {
  process.send({ ok: false, error: String(err && err.code || err) });
}
