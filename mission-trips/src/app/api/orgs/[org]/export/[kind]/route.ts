import { getCurrentUser, orgContextFor } from "@/server/context";
import { AppError } from "@/server/errors";
import { EXPORT_KINDS, runExport, type ExportKind } from "@/server/integrations/exports";

// Downloads a CSV export. Church administrators only; every download is logged.
export async function GET(req: Request, { params }: { params: Promise<{ org: string; kind: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to download exports.", { status: 401 });
  const { org, kind } = await params;
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return new Response("Not found.", { status: 404 });
  try {
    const ctx = await orgContextFor(user, org);
    const tripId = new URL(req.url).searchParams.get("trip");
    const out = await runExport(ctx, kind as ExportKind, tripId || null);
    return new Response(out.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${out.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    // Missing or forbidden look the same, so nothing about other churches leaks.
    if (e instanceof AppError) return new Response("Not found.", { status: 404 });
    throw e;
  }
}
