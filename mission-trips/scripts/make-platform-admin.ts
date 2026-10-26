/**
 * Grants platform-administrator rights to an existing account.
 * Usage: npm run make-admin -- someone@example.org
 */
import { db } from "@/server/db";

async function main() {
  const email = process.argv[2]?.toLowerCase();
  if (!email) throw new Error("Usage: npm run make-admin -- someone@example.org");
  const user = await db.user.update({ where: { email }, data: { platformRole: "PLATFORM_ADMIN" } }).catch(() => null);
  if (!user) throw new Error(`No account found for ${email}. Have them sign up first.`);
  await db.auditLog.create({ data: { orgId: null, actorUserId: null, action: "platform.admin_granted", entityType: "User", entityId: user.id, metadata: { via: "cli" } } });
  console.log(`${user.email} is now a platform administrator.`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
