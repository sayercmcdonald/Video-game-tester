import Link from "next/link";
import { Logo } from "./brand";

/** Minimal frame for public pages (giving, trip updates, receipts). */
export function PublicShell({ orgName, children }: { orgName?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="glass sticky top-0 z-30 border-b border-line no-print" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <span className="font-medium">{orgName ?? <Logo />}</span>
          <Link href="/donor" className="text-sm text-ink-2 hover:text-ink">
            My giving
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
      <footer className="border-t border-line py-6 text-center text-xs text-ink-3 no-print">
        Powered by <Logo href="/" />
      </footer>
    </div>
  );
}
