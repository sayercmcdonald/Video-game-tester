import { redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { LinkButton } from "@/components/ui";
import { getCurrentUser } from "@/server/context";
import { env } from "@/server/env";

const steps = [
  { title: "Plan", body: "Trips, dates, budgets, itineraries and team limits for every trip your church runs." },
  { title: "Build the team", body: "Applications, approvals and invitations. Approving someone sets up their support page and their checklist." },
  { title: "Fund it", body: "Participant and team giving pages through Stripe. Gifts count only when the money arrives; pledges are tracked separately." },
  { title: "Get ready", body: "Waivers, passport copies, forms and tasks with due dates. See who is behind before it becomes a problem." },
  { title: "Spend carefully", body: "Expenses with receipts, approved by an administrator, measured against the budget." },
  { title: "Report back", body: "Publish a reviewed summary of what was given and how it was used. No donor or participant names." },
];

export default async function Landing() {
  if (await getCurrentUser()) redirect("/home");
  return (
    <div className="min-h-dvh">
      <header
        className="mx-auto flex max-w-5xl items-center justify-between py-4"
        style={{ paddingLeft: "max(16px, env(safe-area-inset-left))", paddingRight: "max(16px, env(safe-area-inset-right))", paddingTop: "max(16px, env(safe-area-inset-top))" }}
      >
        <Logo />
        <nav className="flex gap-1">
          <LinkButton href="/login" variant="ghost">
            Sign in
          </LinkButton>
          <LinkButton href="/signup" className="hidden sm:inline-flex">
            Get started
          </LinkButton>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 pt-10 pb-24 sm:px-6 sm:pt-16">
        <p className="text-[15px] font-semibold text-accent">Mission management for churches</p>
        <h1 className="mt-2 max-w-3xl text-[40px] leading-[1.08] font-bold tracking-tight sm:text-[56px]">Everything a mission trip needs, from first meeting to final report.</h1>
        <p className="mt-5 max-w-2xl text-[19px] leading-relaxed text-ink-2">
          Sent connects your team, fundraising, paperwork and spending in one place, and shows donors how their gifts were used. It works alongside the church
          software you already have.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          {env().DEMO_MODE && (
            <LinkButton href="/login#demo" className="h-12 px-6 lg:h-11">
              Explore the demo
            </LinkButton>
          )}
          <LinkButton href="/signup?next=/new-church" variant={env().DEMO_MODE ? "secondary" : "primary"} className="h-12 px-6 lg:h-11">
            Set up your church
          </LinkButton>
          <LinkButton href="/login" variant="secondary" className="h-12 px-6 lg:h-11">
            I was invited to a trip
          </LinkButton>
        </div>
        <ol className="mt-16 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-[var(--radius-card)] bg-surface p-6 dark:ring-1 dark:ring-line">
              <div className="text-[13px] font-semibold text-ink-3 tabular-nums">Step {i + 1}</div>
              <h2 className="mt-1 text-[20px] font-semibold tracking-tight">{s.title}</h2>
              <p className="mt-1.5 text-ink-2">{s.body}</p>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
