import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { invalid } from "./errors";

// Private file storage. Files live outside the public web folder under random
// names and are only ever served through an authorized download route.
// The local-disk driver suits a single server with a persistent volume; swap
// in an S3-compatible driver for multi-server hosting (see docs/ARCHITECTURE.md).

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/heic": [".heic"],
  "image/webp": [".webp"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/msword": [".doc"],
  "text/plain": [".txt"],
};

export function allowedTypesDescription() {
  return "PDF, JPG, PNG, HEIC, WEBP, Word or plain text, up to 10 MB";
}

/** Checks the real file signature for common types so a renamed file can't masquerade as a PDF or image. */
function sniff(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(4, 12).toString().startsWith("ftyphei") || buf.subarray(4, 12).toString().startsWith("ftypmif")) return "image/heic";
  if (buf[0] === 0x50 && buf[1] === 0x4b) return "zip"; // docx
  if (buf[0] === 0xd0 && buf[1] === 0xcf) return "ole"; // legacy .doc
  return null;
}

export type ValidatedUpload = { buffer: Buffer; filename: string; mimeType: string; sizeBytes: number; sha256: string };

export async function validateUpload(file: File | null | undefined): Promise<ValidatedUpload> {
  if (!file || typeof file === "string" || file.size === 0) throw invalid("Choose a file to upload.");
  if (file.size > MAX_UPLOAD_BYTES) throw invalid("That file is larger than 10 MB.");
  const ext = path.extname(file.name).toLowerCase();
  const declared = file.type || "";
  const allowedForType = ALLOWED[declared];
  if (!allowedForType || !allowedForType.includes(ext)) throw invalid(`That file type isn't accepted. Use ${allowedTypesDescription()}.`);
  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniff(buffer);
  const ok =
    declared === "text/plain"
      ? sniffed === null && !buffer.includes(0)
      : declared.includes("wordprocessingml")
        ? sniffed === "zip"
        : declared === "application/msword"
          ? sniffed === "ole"
          : sniffed === declared;
  if (!ok) throw invalid("That file's contents don't match its type. Please export it again as a PDF or image.");
  const filename = path.basename(file.name).replace(/[^\w.\- ()]/g, "_").slice(0, 150) || `upload${ext}`;
  return { buffer, filename, mimeType: declared, sizeBytes: file.size, sha256: createHash("sha256").update(buffer).digest("hex") };
}

function root() {
  return path.resolve(env().STORAGE_DIR);
}

function resolveKey(key: string) {
  if (!/^[a-z0-9]{2}\/[a-z0-9]{40}$/.test(key)) throw new Error("Invalid storage key");
  return path.join(root(), key);
}

export async function putObject(buffer: Buffer): Promise<string> {
  const id = randomBytes(20).toString("hex");
  const key = `${id.slice(0, 2)}/${id}`;
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buffer, { mode: 0o600 });
  return key;
}

export async function getObject(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

export async function deleteObject(key: string): Promise<void> {
  await unlink(resolveKey(key)).catch(() => undefined);
}
