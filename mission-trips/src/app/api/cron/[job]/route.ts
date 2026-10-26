import { env } from "@/server/env";
import { safeEqual } from "@/server/crypto";
import { runAllJobs } from "@/server/jobs";

// Scheduled jobs (deadline reminders, email retries, payment reconciliation).
// Call with: POST /api/cron/all  and header  Authorization: Bearer $CRON_SECRET
export async function POST(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const secret = env().CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return new Response("Unauthorized", { status: 401 });
  const { job } = await params;
  if (job !== "all") return new Response("Unknown job", { status: 404 });
  const result = await runAllJobs();
  return Response.json(result);
}
