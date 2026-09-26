import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { createClient } from "@/lib/supabase/server";

export default async function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/app");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-surface">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/app"
              className="shrink-0 text-[15px] font-semibold tracking-tight text-foreground"
            >
              Ex Communicator
            </Link>
            {user.email ? (
              <span
                className="hidden truncate text-sm text-muted sm:inline"
                title={user.email}
              >
                {user.email}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <AppNav />
            <div className="hidden h-5 w-px bg-border sm:block" aria-hidden />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}
