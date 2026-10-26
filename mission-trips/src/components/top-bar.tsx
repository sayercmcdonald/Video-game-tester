import Link from "next/link";
import { Logo } from "./brand";
import { Avatar } from "./ui";
import { logoutAction } from "@/app/(auth)/actions";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";

/** Top bar for signed-in pages outside a church workspace. */
export async function TopBar({ user }: { user: SessionUser }) {
  const unread = await db.notification.count({ where: { userId: user.id, readAt: null } });
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo href="/home" />
        <UserMenu user={user} unread={unread} />
      </div>
    </header>
  );
}

export function UserMenu({ user, unread }: { user: SessionUser; unread: number }) {
  return (
    <div className="flex items-center gap-1 text-sm">
      <Link href="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative flex items-center rounded-md px-2.5 py-1.5 text-ink-2 hover:bg-subtle hover:text-ink">
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="sm:hidden">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        <span className="hidden sm:inline">Notifications</span>
        {unread > 0 && (
          <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-white tabular-nums">
            {unread > 99 ? "99+" : unread}
            <span className="sr-only"> unread</span>
          </span>
        )}
      </Link>
      <details className="relative">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1 hover:bg-subtle">
          <Avatar name={user.name} />
          <span className="hidden max-w-40 truncate sm:inline">{user.name}</span>
        </summary>
        <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-line bg-surface p-1 shadow-lg">
          <div className="truncate px-3 py-2 text-xs text-ink-3">{user.email}</div>
          <Link href="/home" className="block rounded px-3 py-2 hover:bg-subtle">
            My churches &amp; trips
          </Link>
          <Link href="/donor" className="block rounded px-3 py-2 hover:bg-subtle">
            My giving
          </Link>
          <Link href="/account" className="block rounded px-3 py-2 hover:bg-subtle">
            Account settings
          </Link>
          {user.platformRole === "PLATFORM_ADMIN" && (
            <Link href="/admin" className="block rounded px-3 py-2 hover:bg-subtle">
              Platform admin
            </Link>
          )}
          <form action={logoutAction}>
            <button type="submit" className="block w-full rounded px-3 py-2 text-left hover:bg-subtle">
              Sign out
            </button>
          </form>
        </div>
      </details>
    </div>
  );
}
