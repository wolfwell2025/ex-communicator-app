"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/app", label: "Overview", exact: true },
  { href: "/app/messages", label: "Messages" },
  { href: "/app/calendar", label: "Calendar" },
  { href: "/app/documents", label: "Documents" },
  { href: "/app/expenses", label: "Expenses" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-0.5 rounded-lg border border-border bg-card p-0.5">
      {links.map((link) => {
        const active = link.exact
          ? pathname === link.href
          : pathname === link.href || pathname.startsWith(`${link.href}/`);

        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-surface text-foreground shadow-sm ring-1 ring-border"
                : "text-muted hover:bg-surface/80 hover:text-foreground"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
