import { getCurrentUser } from "@/server/context";
import { authorizeDownload } from "@/server/services/documents";
import { getObject } from "@/server/storage";

// Private files are only ever served here, after a permission check.
// Responses are never cached and are always downloaded, never rendered inline
// as HTML, so an uploaded file can't run scripts on this site.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to view this file.", { status: 401 });
  const { id } = await params;
  const doc = await authorizeDownload(user, id);
  if (!doc) return new Response("Not found.", { status: 404 });
  const body = await getObject(doc.storageKey);
  const inline = doc.mimeType === "application/pdf" || doc.mimeType.startsWith("image/");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(body.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
