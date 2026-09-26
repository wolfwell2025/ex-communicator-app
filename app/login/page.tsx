import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent text-sm font-bold text-white shadow-[var(--shadow-sm)]">
              EC
            </span>
            <span className="text-lg font-semibold tracking-tight text-foreground">
              Ex Communicator
            </span>
          </Link>
          <Link
            href="/"
            className="text-sm font-semibold text-muted transition-colors hover:text-foreground"
          >
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-14 sm:px-6 sm:py-20">
        <div className="rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-lg)] sm:p-9">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
              Welcome back
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Sign in
            </h1>
            <p className="text-base leading-7 text-muted">
              Use your email with a password, or get a one-time magic link.
            </p>
          </div>

          <Suspense
            fallback={
              <p className="mt-6 text-sm text-muted">Loading form…</p>
            }
          >
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          <Link
            href="/"
            className="font-semibold text-accent transition-colors hover:text-accent-hover"
          >
            ← Back to home
          </Link>
        </p>
      </main>
    </div>
  );
}
