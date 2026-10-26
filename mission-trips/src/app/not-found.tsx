import { Logo } from "@/components/brand";
import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Logo />
      <h1 className="mt-8 text-2xl font-semibold">We couldn&apos;t find that page</h1>
      <p className="mt-2 max-w-md text-ink-2">It may have moved, or you may not have access to it. If someone sent you this link, ask them to check it.</p>
      <LinkButton href="/home" className="mt-6">
        Go to my home page
      </LinkButton>
    </main>
  );
}
