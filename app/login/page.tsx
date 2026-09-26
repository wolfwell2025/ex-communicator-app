import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Ex Communicator
          </Link>
          <Link
            href="/"
            className="text-sm font-medium text-muted hover:text-foreground"
          >
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
        <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Use your email with a password, or get a one-time magic link.
          </p>

          <Suspense fallback={<p className="mt-6 text-sm text-muted">Loading...</p>}>
            <LoginForm />
          </Suspense>

          <p className="mt-6 text-center text-sm text-muted">
            <Link href="/" className="text-accent hover:underline">
              Back to home
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
