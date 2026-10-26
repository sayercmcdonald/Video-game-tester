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
  EMAIL_FROM: z.string().default("Mission Trips <no-reply@example.org>"),
  RESEND_API_KEY: z.string().optional().default(""),
  STORAGE_DIR: z.string().default("./storage/uploads"),
  CRON_SECRET: z.string().optional().default(""),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
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
