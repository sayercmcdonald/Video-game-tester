// Demo accounts created by prisma/seed.ts. Used only when DEMO_MODE is on.
export const DEMO_PASSWORD = "demo-password-123";

export const DEMO_ACCOUNTS = [
  { email: "admin@demo.test", name: "Ruth", role: "Church admin", what: "Sees every trip, gift, expense and approval." },
  { email: "leader@demo.test", name: "Marcus", role: "Trip leader", what: "Runs the team, requirements and travel." },
  { email: "hannah@demo.test", name: "Hannah", role: "Participant", what: "Her fundraising page and checklist." },
  { email: "eli@demo.test", name: "Eli", role: "Applicant", what: "Waiting on a decision." },
  { email: "platform@demo.test", name: "Platform", role: "Platform admin", what: "Approves churches; no church records." },
] as const;
