"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-[var(--shadow-sm)] transition-colors hover:bg-accent-hover print:hidden"
    >
      Print / Save as PDF
    </button>
  );
}
