import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Ex Communicator
          </Link>
          <Link
            href="/app"
            className="text-sm font-medium text-muted hover:text-foreground"
          >
            Skip to app shell
          </Link>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
        <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Sign-in is coming soon. This page is a placeholder until Supabase
            Auth is wired up.
          </p>

          <form className="mt-6 space-y-4" aria-disabled="true">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Email</span>
              <input
                type="email"
                disabled
                placeholder="you@example.com"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Password</span>
              <input
                type="password"
                disabled
                placeholder="••••••••"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted"
              />
            </label>
            <button
              type="button"
              disabled
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white opacity-60"
            >
              Sign in (coming soon)
            </button>
          </form>

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
