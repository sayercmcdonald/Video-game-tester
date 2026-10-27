import "server-only";
import { createHash } from "node:crypto";
import sharp, { type OutputInfo } from "sharp";
import { invalid } from "./errors";

// Photos and short videos for mission stories.
//
// Photos are always re-encoded on the server: that removes EXIF metadata
// (phone photos usually carry the GPS position where they were taken), fixes
// orientation, caps the size and makes a thumbnail. The browser also shrinks
// photos before upload, but the server never relies on that.
//
// Videos can't be re-encoded without a transcoder, so the server checks the
// container, enforces size and length limits, and blanks the metadata boxes
// where phones store location (see stripMp4Metadata).

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 90;
export const MAX_MEDIA_PER_STORY = 10;
const PHOTO_MAX_EDGE = 2048;
const THUMB_MAX_EDGE = 640;

export type ProcessedMedia = {
  kind: "PHOTO" | "VIDEO";
  full: Buffer;
  thumb: Buffer | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sha256: string;
};

function sniffImage(buf: Buffer): "jpeg" | "png" | "webp" | "heic" | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  const brand = buf.subarray(4, 12).toString("latin1");
  if (brand.startsWith("ftypheic") || brand.startsWith("ftypheix") || brand.startsWith("ftypmif1") || brand.startsWith("ftyphevc")) return "heic";
  return null;
}

const VIDEO_BRANDS = ["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "qt  ", "M4V ", "M4VP", "MSNV", "3gp4", "3gp5"];

function sniffVideo(buf: Buffer): boolean {
  return buf.length > 12 && buf.subarray(4, 8).toString("latin1") === "ftyp" && VIDEO_BRANDS.includes(buf.subarray(8, 12).toString("latin1"));
}

/** Re-encodes a photo (dropping all metadata) and makes a thumbnail. */
export async function processPhoto(buf: Buffer): Promise<ProcessedMedia> {
  if (buf.length > MAX_PHOTO_BYTES) throw invalid("That photo is larger than 25 MB.");
  const type = sniffImage(buf);
  if (type === "heic")
    throw invalid("This photo is in HEIC format, which can't be processed here. Choose it again from your photo library, which converts it, or set your camera to \"Most Compatible\".");
  if (!type) throw invalid("That doesn't look like a photo. Use JPG, PNG or WEBP.");
  let full: { data: Buffer; info: OutputInfo };
  let thumb: Buffer;
  try {
    const base = () => sharp(buf, { failOn: "error", limitInputPixels: 80_000_000 }).rotate();
    // sharp drops EXIF, XMP and IPTC metadata unless asked to keep it.
    full = await base()
      .resize({ width: PHOTO_MAX_EDGE, height: PHOTO_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    thumb = await base()
      .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75, mozjpeg: true })
      .toBuffer();
  } catch {
    throw invalid("That photo couldn't be read. It may be damaged; try exporting it again.");
  }
  return {
    kind: "PHOTO",
    full: full.data,
    thumb,
    mimeType: "image/jpeg",
    width: full.info.width,
    height: full.info.height,
    durationMs: null,
    sha256: createHash("sha256").update(full.data).digest("hex"),
  };
}

/** Optional poster frame captured in the browser for a video. */
export async function processPoster(buf: Buffer): Promise<Buffer> {
  return (await processPhoto(buf)).thumb!;
}

type Box = { type: string; start: number; size: number; headerSize: number };

function readBoxes(buf: Buffer, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString("latin1");
    let headerSize = 8;
    if (size === 1) {
      if (pos + 16 > end) throw invalid("That video file is damaged.");
      const big = buf.readBigUInt64BE(pos + 8);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid("That video file is damaged.");
      size = Number(big);
      headerSize = 16;
    } else if (size === 0) {
      size = end - pos; // box runs to the end of its parent
    }
    if (size < headerSize || pos + size > end) throw invalid("That video file is damaged.");
    boxes.push({ type, start: pos, size, headerSize });
    pos += size;
  }
  return boxes;
}

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "edts", "dinf", "stbl"]);
// Boxes where cameras and phones store location, device and author details.
const METADATA = new Set(["udta", "meta", "uuid", "XMP_"]);

/**
 * Erases metadata boxes in an MP4/QuickTime file: their contents are zeroed
 * and they're relabelled "free" (padding that players ignore). Sizes and
 * offsets don't change, so the video still plays. Returns the movie duration in milliseconds.
 * Works on the buffer in place.
 */
export function stripMp4Metadata(buf: Buffer): { durationMs: number; blanked: number } {
  let durationMs = -1;
  let blanked = 0;
  const walk = (start: number, end: number, depth: number) => {
    if (depth > 8) return;
    for (const box of readBoxes(buf, start, end)) {
      if (METADATA.has(box.type)) {
        buf.write("free", box.start + 4, "latin1");
        buf.fill(0, box.start + box.headerSize, box.start + box.size); // erase the contents, not just the label
        blanked++;
        continue;
      }
      if (box.type === "mvhd") {
        const p = box.start + box.headerSize;
        const version = buf[p];
        const timescale = version === 1 ? buf.readUInt32BE(p + 20) : buf.readUInt32BE(p + 12);
        const duration = version === 1 ? Number(buf.readBigUInt64BE(p + 24)) : buf.readUInt32BE(p + 16);
        if (timescale > 0) durationMs = Math.round((duration / timescale) * 1000);
      }
      if (CONTAINERS.has(box.type)) walk(box.start + box.headerSize, box.start + box.size, depth + 1);
    }
  };
  walk(0, buf.length, 0);
  if (durationMs < 0) throw invalid("That video file is incomplete (no movie header). Try exporting it again.");
  return { durationMs, blanked };
}

export async function processVideo(buf: Buffer, declaredType: string): Promise<ProcessedMedia> {
  if (buf.length > MAX_VIDEO_BYTES) throw invalid("That video is larger than 80 MB. Trim it to under 90 seconds and try again.");
  if (!sniffVideo(buf)) throw invalid("That video format isn't supported. Use MP4 or MOV from your phone's camera.");
  const { durationMs } = stripMp4Metadata(buf);
  if (durationMs > MAX_VIDEO_SECONDS * 1000) throw invalid(`Videos can be up to ${MAX_VIDEO_SECONDS} seconds long. Trim it and try again.`);
  return {
    kind: "VIDEO",
    full: buf,
    thumb: null,
    mimeType: declaredType === "video/quicktime" ? "video/quicktime" : "video/mp4",
    width: null,
    height: null,
    durationMs,
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
}

export function isVideoType(mime: string) {
  return mime === "video/mp4" || mime === "video/quicktime";
}
