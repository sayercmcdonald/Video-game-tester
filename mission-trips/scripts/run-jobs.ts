/**
 * Runs scheduled jobs once: deadline reminders, payment reconciliation,
 * email retries, expired-session cleanup. Schedule it hourly (cron, or your
 * host's scheduler), or call POST /api/cron/all with the CRON_SECRET.
 */
import { db } from "@/server/db";
import { runAllJobs } from "@/server/jobs";

runAllJobs()
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
