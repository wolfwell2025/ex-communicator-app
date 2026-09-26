"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts?: { types?: string[]; fields?: string[] }
          ) => {
            addListener: (event: string, handler: () => void) => void;
            getPlace: () => {
              formatted_address?: string;
              name?: string;
            };
          };
        };
      };
    };
    __exMapsLoading?: Promise<void>;
  }
}

function loadMapsScript(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps?.places) return Promise.resolve();
  if (window.__exMapsLoading) return window.__exMapsLoading;

  window.__exMapsLoading = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-ex-maps]"
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Maps script failed"))
      );
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;
    script.dataset.exMaps = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Maps script failed"));
    document.head.appendChild(script);
  });
  return window.__exMapsLoading;
}

export function LocationInput({ value, onChange, disabled, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsFailed, setMapsFailed] = useState(false);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || "";

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;
    loadMapsScript(apiKey)
      .then(() => {
        if (!cancelled) setMapsReady(true);
      })
      .catch(() => {
        if (!cancelled) setMapsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  useEffect(() => {
    if (!mapsReady || !inputRef.current || !window.google?.maps?.places) return;
    const autocomplete = new window.google.maps.places.Autocomplete(
      inputRef.current,
      {
        types: ["geocode", "establishment"],
        fields: ["formatted_address", "name"],
      }
    );
    const listener = () => {
      const place = autocomplete.getPlace();
      const address =
        place.formatted_address || place.name || inputRef.current?.value || "";
      onChange(address.slice(0, 300));
    };
    autocomplete.addListener("place_changed", listener);
  }, [mapsReady, onChange]);

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        maxLength={300}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        placeholder={
          apiKey && mapsReady
            ? "Start typing an address…"
            : "Optional address or place"
        }
        autoComplete="off"
      />
      {!apiKey ? (
        <p className="text-[11px] leading-4 text-muted">
          Tip: add{" "}
          <code className="rounded bg-surface px-1">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>{" "}
          for Places autocomplete (plain text works without it).
        </p>
      ) : mapsFailed ? (
        <p className="text-[11px] leading-4 text-muted">
          Places autocomplete unavailable — enter location as text.
        </p>
      ) : null}
    </div>
  );
}
