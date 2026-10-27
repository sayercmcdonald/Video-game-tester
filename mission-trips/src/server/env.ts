import "server-only";
import { z } from "zod";

// All configuration comes from environment variables, validated once.
// A missing required value fails loudly at startup instead of mid-request.
const schema = z.object({
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64-encoded"),
  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  STRIPE_MODE: z.enum(["connect", "platform"]).default("connect"),
  EMAIL_TRANSPORT: z.enum(["log", "resend"]).default("log"),
  EMAIL_FROM: z.string().default("Sent <no-reply@example.org>"),
  RESEND_API_KEY: z.string().optional().default(""),
  STORAGE_DIR: z.string().default("./storage/uploads"),
  CRON_SECRET: z.string().optional().default(""),
  // Public demo only: shows one-tap demo sign-ins. Refused in production.
  DEMO_MODE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  // bcrypt work factor for new password hashes. 12 by default; 10 suits very small demo servers.
  PASSWORD_HASH_COST: z.coerce.number().int().min(10).max(14).default(12),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  // On Render, the public address is provided automatically.
  const source = { ...process.env, APP_URL: process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || undefined };
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  if (e.APP_ENV === "production") {
    if (e.STRIPE_SECRET_KEY.startsWith("sk_test_")) {
      throw new Error("Production must not use a Stripe test key.");
    }
    if (e.EMAIL_TRANSPORT === "log") {
      throw new Error("Production requires a real email transport (EMAIL_TRANSPORT=resend).");
    }
    if (!e.CRON_SECRET) throw new Error("Production requires CRON_SECRET.");
    if (e.DEMO_MODE) throw new Error("DEMO_MODE must not be enabled in production.");
  }
  cached = e;
  return e;
}

export function isProduction() {
  return env().APP_ENV === "production";
}

/** For tests only: re-read process.env. */
export function resetEnvCache() {
  cached = null;
}
