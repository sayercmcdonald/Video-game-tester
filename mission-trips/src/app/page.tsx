import { redirect } from "next/navigation";
import { Logo } from "@/components/brand";
import { LinkButton } from "@/components/ui";
import { getCurrentUser } from "@/server/context";

const features = [
  {
    title: "One place for every trip",
    body: "Dates, itinerary, team roster, required forms and deadlines — for every trip your church runs, side by side.",
  },
  {
    title: "Fundraising that adds up",
    body: "Each participant gets a support page. Gifts are processed by Stripe and recorded only when the money actually arrives.",
  },
  {
    title: "Clear readiness",
    body: "See at a glance who still needs a passport copy, a signed waiver or their fundraising balance — and remind them.",
  },
  {
    title: "Honest reporting to donors",
    body: "Record expenses with receipts, compare against budget, and publish a reviewed summary of how gifts were used.",
  },
];

export default async function Landing() {
  if (await getCurrentUser()) redirect("/home");
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <nav className="flex gap-2">
          <LinkButton href="/login" variant="ghost">
            Sign in
          </LinkButton>
          <LinkButton href="/signup">Get started</LinkButton>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 pt-16 pb-24 sm:px-6">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">Mission trips, organized from first meeting to final report.</h1>
        <p className="mt-5 max-w-xl text-lg text-ink-2">
          Replace the spreadsheets, email threads and separate donation tools. Leaders, participants and donors each see what they need — and nothing they
          shouldn&apos;t.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <LinkButton href="/signup?next=/new-church" className="h-12 px-6 lg:h-11">
            Set up your church
          </LinkButton>
          <LinkButton href="/login" variant="secondary" className="h-12 px-6 lg:h-11">
            I was invited to a trip
          </LinkButton>
        </div>
        <div className="mt-16 grid gap-3 sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="rounded-[var(--radius-card)] bg-surface p-6">
              <h2 className="font-semibold">{f.title}</h2>
              <p className="mt-1.5 text-ink-2">{f.body}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
