import { getCurrentUser } from "@/server/context";
import { authorizeMedia } from "@/server/services/stories";
import { getObject } from "@/server/storage";

// Story photos and videos are only ever served here, after checking that this
// visitor may see the story right now. Taking a story down or revoking a
// follower takes effect on the next request, because nothing is cached.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const { id } = await params;
  const auth = await authorizeMedia(user, id);
  if (!auth) return new Response("Not found.", { status: 404 });
  const { media } = auth;
  const wantThumb = new URL(req.url).searchParams.get("size") === "thumb";
  if (wantThumb && !media.thumbKey) return new Response("No preview.", { status: 404 });
  const body = await getObject(wantThumb ? media.thumbKey! : media.storageKey);
  const type = wantThumb ? "image/jpeg" : media.mimeType;
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Accept-Ranges": "bytes",
  };
  // Phones (Safari in particular) stream video with byte-range requests.
  const range = req.headers.get("range");
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && (m[1] || m[2])) {
    const size = body.length;
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    const chunk = body.subarray(start, end + 1);
    return new Response(new Uint8Array(chunk), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(chunk.length) } });
  }
  return new Response(new Uint8Array(body), { headers: { ...headers, "Content-Length": String(body.length) } });
}
