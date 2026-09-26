import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-surface">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link
            href="/"
            className="text-[15px] font-semibold tracking-tight text-foreground"
          >
            Ex Communicator
          </Link>
          <Link
            href="/"
            className="text-sm font-medium text-muted transition-colors hover:text-foreground"
          >
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-14 sm:px-6 sm:py-20">
        <div className="rounded-xl border border-border bg-card p-7 shadow-[var(--shadow-md)] sm:p-8">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Sign in
            </h1>
            <p className="text-sm leading-6 text-muted">
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
            className="font-medium text-accent transition-colors hover:text-accent-hover"
          >
            ← Back to home
          </Link>
        </p>
      </main>
    </div>
  );
}
