import Link from "next/link";
import { Logo } from "@/components/brand";
import { SideNav, type NavItem } from "@/components/nav";
import { UserMenu } from "@/components/top-bar";
import { Alert, Badge } from "@/components/ui";
import { pageOrg } from "@/server/page-guard";
import { db } from "@/server/db";

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await pageOrg(slug);
  const base = `/o/${ctx.org.slug}`;
  const [unread, pendingApplications] = await Promise.all([
    db.notification.count({ where: { userId: ctx.user.id, readAt: null } }),
    ctx.isAdmin ? db.tripMember.count({ where: { orgId: ctx.org.id, status: "APPLIED" } }) : Promise.resolve(0),
  ]);

  const items: NavItem[] = [
    { href: base, label: "Dashboard", exact: true },
    { href: `${base}/trips`, label: "Trips", count: pendingApplications },
    ...(ctx.isAdmin
      ? [
          { href: `${base}/people`, label: "People" },
          { href: `${base}/donations`, label: "Donations" },
          { href: `${base}/settings`, label: "Settings" },
          { href: `${base}/audit`, label: "Activity log" },
        ]
      : []),
    { href: `${base}/profile`, label: "My profile" },
  ];

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Logo href="/home" compact />
            <span className="hidden text-line-strong sm:inline" aria-hidden>
              /
            </span>
            <Link href={base} className="truncate font-medium">
              {ctx.org.name}
            </Link>
            {ctx.isAdmin && ctx.org.status !== "ACTIVE" && <Badge tone="warn">{ctx.org.status === "PENDING_REVIEW" ? "Pending review" : ctx.org.status}</Badge>}
          </div>
          <UserMenu user={ctx.user} unread={unread} />
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8">
        <aside className="lg:w-48 lg:shrink-0">
          <SideNav items={items} />
        </aside>
        <main id="main" className="min-w-0 flex-1">
          {ctx.isAdmin && ctx.org.status === "PENDING_REVIEW" && (
            <div className="mb-6">
              <Alert tone="info" title="Your church is awaiting approval">
                You can set up trips, invite your team and prepare everything now. Public giving pages turn on once the platform team approves your church and
                you&apos;ve connected a payment account in Settings.
              </Alert>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
