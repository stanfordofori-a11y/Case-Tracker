import { useEffect, useState } from "react";

// Per-computer display preferences. Stored in this browser only, so each
// bench PC can have its own size and theme.
export type Theme = "light" | "dark" | "contrast";
export type Font = "hyperlegible" | "standard" | "system";
export type Density = "comfortable" | "compact";
export interface Display { size: 1 | 2 | 3 | 4 | 5; theme: Theme; font: Font; density: Density }

const KEY = "pat-display";
const DEFAULTS: Display = { size: 2, theme: "light", font: "hyperlegible", density: "comfortable" };

function load(): Display {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch { return DEFAULTS; }
}

export function applyDisplay(d: Display) {
  const el = document.documentElement;
  el.dataset.size = String(d.size);
  el.dataset.theme = d.theme;
  el.dataset.font = d.font;
  el.dataset.density = d.density;
}

export function useDisplay() {
  const [d, setD] = useState<Display>(load);
  useEffect(() => {
    applyDisplay(d);
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode: keep for this session */ }
  }, [d]);
  return [d, (patch: Partial<Display>) => setD((cur) => ({ ...cur, ...patch }))] as const;
}

// Apply saved settings before React renders, so there's no flash of the wrong theme.
applyDisplay(load());
