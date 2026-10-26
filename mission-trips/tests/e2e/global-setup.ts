import { execSync } from "node:child_process";
import { Client } from "pg";

export const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://mission:mission_dev_pw@localhost:5432/mission_e2e";

/** Migrates the dedicated end-to-end database and empties it before the run. */
export default async function globalSetup() {
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: E2E_DB } });
  const c = new Client({ connectionString: E2E_DB });
  await c.connect();
  const { rows } = await c.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`);
  await c.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await c.end();
}
