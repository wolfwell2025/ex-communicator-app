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
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 shadow-[var(--shadow-sm)] backdrop-blur supports-[backdrop-filter]:bg-card/90">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/app" className="flex shrink-0 items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-sm font-bold text-white shadow-[var(--shadow-sm)]">
                EC
              </span>
              <span className="text-lg font-semibold tracking-tight text-foreground">
                Ex Communicator
              </span>
            </Link>
            {user.email ? (
              <span
                className="hidden max-w-[14rem] truncate rounded-full bg-surface px-3 py-1 text-xs font-medium text-muted ring-1 ring-border sm:inline"
                title={user.email}
              >
                {user.email}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <AppNav />
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
