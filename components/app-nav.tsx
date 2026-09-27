"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/app", label: "Overview", exact: true },
  { href: "/app/messages", label: "Messages" },
  { href: "/app/calendar", label: "Calendar" },
  { href: "/app/documents", label: "Documents" },
  { href: "/app/expenses", label: "Expenses" },
  { href: "/app/profile", label: "Profile" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1 rounded-2xl border border-border bg-surface p-1.5">
      {links.map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${
              active
                ? "bg-card text-accent shadow-[var(--shadow-sm)] ring-1 ring-border"
                : "text-muted hover:bg-card/70 hover:text-foreground"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
