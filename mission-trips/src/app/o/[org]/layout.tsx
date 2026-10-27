import Link from "next/link";
import { Logo } from "@/components/brand";
import { SideNav, TabBar, type NavItem } from "@/components/nav";
import { GlassHeader, UserMenu } from "@/components/top-bar";
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

  // Phones: up to five single-word tabs. Wide screens: the same places plus a few more in a sidebar.
  const tabs: NavItem[] = ctx.isAdmin
    ? [
        { href: base, label: "Home", exact: true, icon: "home" },
        { href: `${base}/trips`, label: "Trips", icon: "trips", count: pendingApplications },
        { href: `${base}/donations`, label: "Giving", icon: "giving" },
        { href: `${base}/people`, label: "People", icon: "people" },
        { href: `${base}/settings`, label: "Settings", icon: "settings" },
      ]
    : [
        { href: base, label: "Home", exact: true, icon: "home" },
        { href: `${base}/trips`, label: "Trips", icon: "trips" },
        { href: `${base}/profile`, label: "Profile", icon: "person" },
      ];
  const sidebar: NavItem[] = ctx.isAdmin
    ? [...tabs, { href: `${base}/audit`, label: "Activity log" }, { href: `${base}/profile`, label: "My profile" }]
    : tabs;

  return (
    <div className="min-h-dvh">
      <GlassHeader>
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden lg:inline-flex">
            <Logo href="/home" />
          </span>
          <span className="hidden text-ink-3 lg:inline" aria-hidden>
            /
          </span>
          <Link href={base} className="truncate text-[17px] font-semibold lg:text-[15px]">
            {ctx.org.name}
          </Link>
          {ctx.isAdmin && ctx.org.status !== "ACTIVE" && (
            <span className="hidden sm:inline-flex">
              <Badge tone="warn">{ctx.org.status === "PENDING_REVIEW" ? "Pending review" : ctx.org.status}</Badge>
            </span>
          )}
        </div>
        <UserMenu user={ctx.user} unread={unread} />
      </GlassHeader>
      <div
        className="mx-auto flex max-w-7xl gap-8 pt-5 pb-32 lg:pt-8 lg:pb-12"
        style={{ paddingLeft: "max(16px, env(safe-area-inset-left))", paddingRight: "max(16px, env(safe-area-inset-right))" }}
      >
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-22">
            <SideNav items={sidebar} />
          </div>
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
      <TabBar items={tabs} />
    </div>
  );
}
