import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

export type Db = PrismaClient;
/** A Prisma transaction client, for functions that must run inside a transaction. */
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function create() {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });
  return new PrismaClient({ adapter });
}

// One client per process (Next.js dev hot-reload would otherwise open many pools).
export const db: PrismaClient = globalForPrisma.prisma ?? create();
if (env().APP_ENV !== "production") globalForPrisma.prisma = db;
