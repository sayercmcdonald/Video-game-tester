import { getCurrentUser, orgContextFor, tripContextFor } from "@/server/context";
import { AppError } from "@/server/errors";
import { MAX_VIDEO_BYTES } from "@/server/media";
import { rateLimit } from "@/server/rate-limit";
import { addMedia } from "@/server/services/stories";

// Photo and video uploads for a story. A plain endpoint (rather than a server
// action) so phones can show upload progress and retry one file at a time.
// Uploading never publishes anything: the story stays a draft until submitted.
const STATUS: Record<AppError["code"], number> = { NOT_FOUND: 404, FORBIDDEN: 404, UNAUTHENTICATED: 401, INVALID: 422, CONFLICT: 409, UNAVAILABLE: 503 };

export async function POST(req: Request, { params }: { params: Promise<{ org: string; tripId: string; storyId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in again to upload." }, { status: 401 });
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_VIDEO_BYTES + 1024 * 1024) return Response.json({ error: "That file is too large. Videos can be up to 80 MB." }, { status: 413 });
  const limit = rateLimit(`media-upload:${user.id}`, 60, 10 * 60 * 1000);
  if (!limit.ok) return Response.json({ error: "Too many uploads at once. Wait a few minutes and try again." }, { status: 429 });
  const { org, tripId, storyId } = await params;
  try {
    const t = await tripContextFor(await orgContextFor(user, org), tripId);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Choose a photo or video." }, { status: 422 });
    const poster = form.get("poster");
    const media = await addMedia(t, storyId, file, { poster: poster instanceof File ? poster : null, altText: String(form.get("altText") ?? "") });
    return Response.json({ id: media.id, kind: media.kind, thumbUrl: `/api/media/${media.id}?size=thumb` }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.code === "FORBIDDEN" ? "Not found." : e.message }, { status: STATUS[e.code] });
    console.error("media upload failed", e);
    return Response.json({ error: "The upload didn't finish. Try again." }, { status: 500 });
  }
}
