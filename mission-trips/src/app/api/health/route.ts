import { db } from "@/server/db";

// For uptime monitors and load balancers. Reveals nothing sensitive.
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
