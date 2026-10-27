"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cx } from "./ui";
import { Icon, type IconName } from "./icons";

export type NavItem = { href: string; label: string; exact?: boolean; count?: number; icon?: IconName };

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function CountBadge({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="ml-auto min-w-5 rounded-full bg-bad px-1.5 text-center text-xs leading-5 font-semibold text-white tabular-nums">
      {n > 99 ? "99+" : n}
      <span className="sr-only"> waiting</span>
    </span>
  );
}

/** Sidebar on wide screens (Apple: a tab bar adapts into a sidebar when there's room). */
export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace" className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[15px]",
              active ? "bg-accent-soft font-semibold text-accent-ink" : "text-ink hover:bg-fill",
            )}
          >
            {item.icon && (
              <span className={active ? "text-accent" : "text-ink-3"}>
                <Icon name={item.icon} active={active} size={20} />
              </span>
            )}
            {item.label}
            <CountBadge n={item.count} />
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Floating tab bar at the bottom of the screen on phones. It sits on a
 * translucent material above content, never hides, and is for navigation only.
 */
export function TabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 px-3 lg:hidden"
      style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))", paddingLeft: "max(12px, env(safe-area-inset-left))", paddingRight: "max(12px, env(safe-area-inset-right))" }}
    >
      <div className="glass mx-auto flex max-w-md items-stretch justify-around rounded-[28px] px-1.5 py-1.5 shadow-[0_8px_30px_rgb(0_0_0/0.12)] ring-1 ring-line">
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "relative flex min-h-12 min-w-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-[22px] px-1 text-[11px] leading-none font-medium transition-colors",
                active ? "bg-fill text-accent" : "text-ink-2",
              )}
            >
              {item.icon && <Icon name={item.icon} active={active} size={24} />}
              <span>{item.label}</span>
              {item.count ? (
                <span className="absolute top-0.5 left-1/2 ml-1.5 min-w-[18px] rounded-full bg-bad px-1 text-center text-[11px] leading-[18px] font-semibold text-white tabular-nums">
                  {item.count > 99 ? "99+" : item.count}
                  <span className="sr-only"> waiting</span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Sections within a trip: a scrolling row of capsules; the selected one scrolls into view. */
export function Tabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[aria-current=page]")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);
  return (
    <nav ref={ref} aria-label="Trip sections" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[15px] whitespace-nowrap transition-colors lg:h-8 lg:px-3.5 lg:text-sm",
              active ? "bg-ink font-semibold text-canvas" : "bg-surface text-ink hover:bg-fill dark:bg-subtle",
            )}
          >
            {item.label}
            {item.count ? (
              <span className={cx("min-w-5 rounded-full px-1.5 text-center text-xs leading-5 font-semibold tabular-nums", active ? "bg-canvas/20" : "bg-bad text-white")}>
                {item.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
