"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover print:hidden"
    >
      Print / Save as PDF
    </button>
  );
}
