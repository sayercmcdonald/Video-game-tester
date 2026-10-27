"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

// A thin bar at the top of the screen that appears as soon as a link or form
// is tapped, so a slow server never looks like an unresponsive app.
function Bar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const qs = search.toString();
  const here = pathname + (qs ? `?${qs}` : "");
  // The page we were on when the tap happened; the bar stops once we've moved on.
  const [from, setFrom] = useState<string | null>(null);
  const active = from === here;
  const setActive = (on: boolean) => setFrom(on ? location.pathname + location.search : null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      if (url.pathname.startsWith("/api/")) return;
      setActive(true);
    };
    const onSubmit = () => setActive(true);
    const onDone = () => setActive(false);
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onDone);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onDone);
    };
  }, []);

  // Forms that stay on the same page (validation errors) shouldn't leave the bar running.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setActive(false), 15000);
    return () => clearTimeout(t);
  }, [active]);

  return <div aria-hidden className={`nav-progress ${active ? "nav-progress-on" : ""}`} />;
}

export function NavProgress() {
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}
