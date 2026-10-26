import { Logo } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pt-16 pb-10">
      <div className="mb-8">
        <Logo />
      </div>
      <main id="main" className="w-full max-w-sm">
        {children}
      </main>
    </div>
  );
}
