/**
 * DEVELOPMENT / DEMO DATA ONLY.
 *
 * Creates a clearly labeled demo church so you can click through every
 * screen. It refuses to run against production. It never creates online
 * (Stripe) payments: the only gifts are check gifts recorded the same way a
 * church admin would record them, marked "Demo".
 *
 * Run: npm run db:seed
 */
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { orgContextFor, tripContextFor } from "@/server/context";
import { createTrip, decideApplication, addItineraryItem, applyToTrip } from "@/server/services/trips";
import { recordOfflineDonation } from "@/server/services/donations";
import { createRequirement, submitRequirement, reviewSubmission } from "@/server/services/requirements";
import { createExpense, createPledge, setBudgetLines } from "@/server/services/finance";
import { createPost } from "@/server/services/posts";
import { ensureParticipantCampaign } from "@/server/services/campaigns";
import type { SessionUser } from "@/server/auth/session";

const PASSWORD = "demo-password-123";

async function main() {
  if (process.env.APP_ENV === "production") throw new Error("Refusing to seed demo data in production.");
  const existing = await db.organization.findUnique({ where: { slug: "demo-grace" } });
  if (existing) {
    console.log("Demo data already exists (church 'demo-grace'). Run `npm run db:reset` to start over.");
    return;
  }
  const hash = await hashPassword(PASSWORD);
  const mk = async (name: string, email: string, platformRole: "USER" | "PLATFORM_ADMIN" = "USER"): Promise<SessionUser> => {
    const u = await db.user.create({ data: { name, email, passwordHash: hash, platformRole, emailVerifiedAt: new Date(), preferences: { create: {} } } });
    return { id: u.id, email: u.email, name: u.name, platformRole: u.platformRole, emailVerifiedAt: u.emailVerifiedAt };
  };

  await mk("Demo Platform Admin", "platform@demo.test", "PLATFORM_ADMIN");
  const admin = await mk("Ruth Alvarez (demo)", "admin@demo.test");
  const leader = await mk("Marcus Lee (demo)", "leader@demo.test");
  const p1 = await mk("Hannah Cole (demo)", "hannah@demo.test");
  const p2 = await mk("Josiah Park (demo)", "josiah@demo.test");
  const p3 = await mk("Ana Torres (demo)", "ana@demo.test");
  const applicant = await mk("Eli Brooks (demo)", "eli@demo.test");

  const org = await db.organization.create({
    data: {
      name: "Demo: Grace Community Church",
      slug: "demo-grace",
      contactEmail: "office@demo.test",
      status: "ACTIVE",
      receiptStatement: "DEMO RECEIPT — this text is set by the church in Settings.",
    },
  });
  for (const [u, role] of [[admin, "ADMIN"], [leader, "MEMBER"], [p1, "MEMBER"], [p2, "MEMBER"], [p3, "MEMBER"]] as const) {
    await db.membership.create({ data: { orgId: org.id, userId: u.id, role } });
  }
  const adminCtx = await orgContextFor(admin, org.slug);

  const year = new Date().getUTCFullYear() + 1;
  const trip = await createTrip(adminCtx, {
    name: "Demo Guatemala Summer Team",
    destination: "Antigua, Guatemala",
    summary: "A ten-day trip partnering with a local church to run a kids' program and help finish a classroom building. (Demo data.)",
    startDate: `${year}-06-12`,
    endDate: `${year}-06-22`,
    budget: "18000",
    fundraisingGoal: "6000",
    defaultParticipantGoal: "2400",
    participantLimit: "12",
    applicationsOpen: "on",
  });
  await db.trip.update({ where: { id: trip.id }, data: { status: "OPEN" } });
  await db.tripMember.create({ data: { orgId: org.id, tripId: trip.id, userId: leader.id, role: "LEADER", status: "APPROVED", decidedAt: new Date() } });

  const t = await tripContextFor(adminCtx, trip.id);
  for (const p of [p1, p2, p3]) {
    const tm = await db.tripMember.create({ data: { orgId: org.id, tripId: trip.id, userId: p.id, role: "PARTICIPANT", status: "APPLIED" } });
    await decideApplication(t, tm.id, "APPROVED");
    await db.$transaction((tx) => ensureParticipantCampaign(tx, tm.id));
  }
  await applyToTrip(applicant, org.slug, trip.id, "I served in VBS for three summers and would love to help with the kids' program. (Demo)");

  // Requirements
  const passport = await createRequirement(t, { kind: "UPLOAD", title: "Passport copy", instructions: "Upload a clear photo or scan of your passport photo page. It must be valid for 6 months after the trip.", dueDate: `${year}-03-01`, needsReview: "on", isRequired: "on" });
  const waiver = await createRequirement(t, {
    kind: "WAIVER",
    title: "Participation waiver",
    waiverText: "DEMO WAIVER TEXT. Replace this with the waiver your church's legal counsel has approved.",
    dueDate: `${year}-03-15`,
    isRequired: "on",
  });
  await createRequirement(t, {
    kind: "FORM",
    title: "Health & dietary form",
    instructions: "Leaders use this to plan meals and care. Only leaders and church admins can see answers.",
    formQuestions: "Do you have any food allergies? [yes/no]\nPlease describe any allergies or dietary needs (optional)\nAnything else leaders should know about your health? (optional)",
    dueDate: `${year}-04-01`,
    needsReview: "on",
    isRequired: "on",
  });
  await createRequirement(t, { kind: "TASK", title: "Attend team orientation", instructions: "Sunday after second service, room 204.", dueDate: `${year}-05-03`, isRequired: "on" });

  // Some progress
  const ctxP1 = await tripContextFor(await orgContextFor(p1, org.slug), trip.id);
  const fd = new FormData();
  fd.set("signedName", p1.name);
  fd.set("agree", "on");
  await submitRequirement(ctxP1, waiver.id, fd);
  const pdf = new File([Buffer.from("%PDF-1.4\n% Demo passport placeholder\n%%EOF")], "demo-passport.pdf", { type: "application/pdf" });
  const fd2 = new FormData();
  fd2.set("file", pdf);
  const sub = await submitRequirement(ctxP1, passport.id, fd2);
  await reviewSubmission(t, sub.id, "APPROVED");

  // Check gifts recorded by the church (no online payments are fabricated)
  const campaigns = await db.campaign.findMany({ where: { tripId: trip.id }, include: { tripMember: true } });
  const fund = campaigns.find((c) => c.kind === "TRIP")!;
  const forP = (u: SessionUser) => campaigns.find((c) => c.tripMember?.userId === u.id)!;
  const gifts: [string, string, string, string][] = [
    [forP(p1).id, "The Coles (demo)", "500", "1001"],
    [forP(p1).id, "R. Nguyen (demo)", "250", "1002"],
    [forP(p2).id, "Park Family (demo)", "800", "1003"],
    [forP(p3).id, "Small Group 4 (demo)", "300", "1004"],
    [fund.id, "Missions Committee (demo)", "2000", "1005"],
  ];
  for (const [campaignId, donorName, amount, reference] of gifts) {
    await recordOfflineDonation(t, { campaignId, donorName, amount, method: "CHECK", reference, receivedOn: new Date().toISOString().slice(0, 10) });
  }
  await createPledge(t, { campaignId: forP(p2).id, donorName: "Grandparents Park (demo)", amount: "400", expectedBy: `${year}-02-01` });

  // Budget and expenses
  const budget = new FormData();
  for (const [k, v] of Object.entries({ TRAVEL: "9600", LODGING: "3200", FOOD: "2000", GROUND_TRANSPORT: "1200", PROJECT_MATERIALS: "1500", INSURANCE: "500" })) budget.set(`budget_${k}`, v);
  await setBudgetLines(t, budget);
  await createExpense(t, { category: "TRAVEL", description: "Demo: group airfare deposit", vendor: "Demo Travel Co.", amount: "2400", status: "PAID", incurredOn: new Date().toISOString().slice(0, 10), paidOn: new Date().toISOString().slice(0, 10) });
  await createExpense(t, { category: "LODGING", description: "Demo: guesthouse booking", vendor: "Demo Guesthouse", amount: "3200", status: "COMMITTED", incurredOn: new Date().toISOString().slice(0, 10) });

  // A leader submits an expense; it waits for an administrator's approval.
  const leaderT = await tripContextFor(await orgContextFor(leader, org.slug), trip.id);
  await createExpense(leaderT, { category: "GROUND_TRANSPORT", description: "Demo: van rental deposit", vendor: "Demo Rentals", amount: "450", status: "PAID", incurredOn: new Date().toISOString().slice(0, 10), paidOn: new Date().toISOString().slice(0, 10) });
  await db.trip.update({ where: { id: trip.id }, data: { showLiveFinancials: true } });

  await createPost(t, { title: "Welcome to the team!", body: "We're thrilled to serve together. Please finish your passport copy and waiver this month. (Demo)", audience: "TEAM" });
  await createPost(t, { title: "Fundraising is underway", body: "Thank you for praying and giving. The team is preparing a kids' program and helping finish a classroom. (Demo)", audience: "PUBLIC" });
  await addItineraryItem(t, { kind: "MEETING", title: "Team orientation", startsAt: `${year}-05-03T12:30`, location: "Room 204" });
  await addItineraryItem(t, { kind: "TRAVEL", title: "Depart for Guatemala City", startsAt: `${year}-06-12T07:15`, location: "Airport" });

  console.log(`
Demo data created. Sign in at /login with any of these (password: ${PASSWORD}):
  admin@demo.test     church administrator
  leader@demo.test    trip leader
  hannah@demo.test    participant (some requirements done)
  eli@demo.test       applicant awaiting review
  platform@demo.test  platform administrator
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
