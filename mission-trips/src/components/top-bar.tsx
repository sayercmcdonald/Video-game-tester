import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "./brand";
import { Avatar } from "./ui";
import { Icon } from "./icons";
import { logoutAction } from "@/app/(auth)/actions";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";

/** A translucent bar pinned to the top (Apple's navigation bar), respecting the phone's safe area. */
export function GlassHeader({ children }: { children: ReactNode }) {
  return (
    <header className="glass sticky top-0 z-30 border-b border-line" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div
        className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3"
        style={{ paddingLeft: "max(16px, env(safe-area-inset-left))", paddingRight: "max(16px, env(safe-area-inset-right))" }}
      >
        {children}
      </div>
    </header>
  );
}

/** Top bar for signed-in pages outside a church workspace. */
export async function TopBar({ user }: { user: SessionUser }) {
  const unread = await db.notification.count({ where: { userId: user.id, readAt: null } });
  return (
    <GlassHeader>
      <Logo href="/home" />
      <UserMenu user={user} unread={unread} />
    </GlassHeader>
  );
}

export function UserMenu({ user, unread }: { user: SessionUser; unread: number }) {
  return (
    <div className="flex items-center gap-1">
      <Link
        href="/notifications"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className="relative flex size-11 items-center justify-center rounded-full text-ink-2 hover:bg-fill hover:text-ink"
      >
        <Icon name="bell" size={22} />
        {unread > 0 && (
          <span aria-hidden className="absolute top-1.5 right-1 min-w-[18px] rounded-full bg-bad px-1 text-center text-[11px] leading-[18px] font-semibold text-white tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Link>
      <details className="relative">
        <summary aria-label="Account menu" className="flex size-11 cursor-pointer list-none items-center justify-center rounded-full hover:bg-fill">
          <Avatar name={user.name} size={32} />
        </summary>
        <div className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-2xl bg-surface shadow-[0_12px_40px_rgb(0_0_0/0.18)] ring-1 ring-line">
          <div className="border-b border-line px-4 py-3">
            <div className="truncate font-semibold">{user.name}</div>
            <div className="truncate text-[13px] text-ink-3">{user.email}</div>
          </div>
          <div className="divide-y divide-line">
            <MenuLink href="/home">My churches &amp; trips</MenuLink>
            <MenuLink href="/donor">My giving</MenuLink>
            <MenuLink href="/account">Account settings</MenuLink>
            {user.platformRole === "PLATFORM_ADMIN" && <MenuLink href="/admin">Platform admin</MenuLink>}
            <form action={logoutAction}>
              <button type="submit" className="block min-h-11 w-full px-4 py-2.5 text-left text-bad hover:bg-subtle">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </details>
    </div>
  );
}

function MenuLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="flex min-h-11 items-center px-4 py-2.5 hover:bg-subtle">
      {children}
    </Link>
  );
}
