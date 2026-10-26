"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export type NavItem = { href: string; label: string; exact?: boolean; count?: number };

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Vertical navigation for the church workspace (desktop) that becomes a scrollable row on phones. */
export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex items-center justify-between rounded-md px-3 py-1.5 text-sm whitespace-nowrap",
              active ? "bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-2 hover:bg-subtle hover:text-ink",
            )}
          >
            {item.label}
            {item.count ? <span className="ml-2 rounded-full bg-warn-soft px-1.5 text-xs font-medium text-warn tabular-nums">{item.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Horizontal tabs inside a trip. */
export function Tabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Trip sections" className="-mb-px flex gap-1 overflow-x-auto">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "border-b-2 px-3 py-2.5 text-sm whitespace-nowrap",
              active ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:border-line-strong hover:text-ink",
            )}
          >
            {item.label}
            {item.count ? <span className="ml-1.5 rounded-full bg-warn-soft px-1.5 text-xs font-medium text-warn tabular-nums">{item.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
