"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getSiteUrl } from "@/lib/supabase/env";

type Mode = "password" | "magic";

const fieldClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-foreground shadow-[var(--shadow-sm)] placeholder:text-muted-foreground transition-colors hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/app";
  const authError = searchParams.get("error");

  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(
    authError === "auth"
      ? "Sign-in link was invalid or expired. Try again."
      : null
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    // Prefer NEXT_PUBLIC_SITE_URL so production email links never use localhost.
    const emailRedirectTo = `${getSiteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`;

    try {
      if (mode === "magic") {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo },
        });
        if (otpError) throw otpError;
        setMessage("Check your email for the magic link.");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        // First-time users: create the account then continue.
        if (signInError.message.toLowerCase().includes("invalid login")) {
          const { error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo },
          });
          if (signUpError) throw signUpError;
          setMessage(
            "Account created. Check your email to confirm, or sign in if confirmation is disabled."
          );
          return;
        }
        throw signInError;
      }

      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={onSubmit}>
      <div className="flex rounded-lg border border-border bg-surface p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode("password")}
          className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
            mode === "password"
              ? "bg-card text-foreground shadow-sm ring-1 ring-border"
              : "text-muted hover:text-foreground"
          }`}
        >
          Password
        </button>
        <button
          type="button"
          onClick={() => setMode("magic")}
          className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
            mode === "magic"
              ? "bg-card text-foreground shadow-sm ring-1 ring-border"
              : "text-muted hover:text-foreground"
          }`}
        >
          Magic link
        </button>
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium text-foreground">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className={fieldClass}
        />
      </label>

      {mode === "password" ? (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">Password</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={fieldClass}
          />
        </label>
      ) : null}

      {error ? (
        <p
          className="rounded-lg border border-red-200 bg-danger-soft px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          className="rounded-lg border border-border bg-accent-soft px-3 py-2 text-sm text-accent"
          role="status"
        >
          {message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover disabled:opacity-60"
      >
        {loading
          ? "Working..."
          : mode === "magic"
            ? "Send magic link"
            : "Sign in / Sign up"}
      </button>
    </form>
  );
}
