import { useEffect, useState } from "react";

/**
 * App-wide UI scale — three density variants (sm / base / lg).
 *
 * All Tailwind spacing + typography derives from rem, so the whole app scales
 * via the root font size. The CSS lives in each app's stylesheet (the
 * `html[data-app-scale="sm|lg"]` blocks in globals.css / styles.css).
 *
 * REVERT: delete this file, its exports in index.ts, the CSS blocks, the
 * applyPersistedAppScale() call in each main.tsx, and the toggle button in
 * chat-list.tsx.
 */
export type AppScale = "sm" | "base" | "lg";

/** Cycle order used by the UI toggle. */
export const APP_SCALES: AppScale[] = ["sm", "base", "lg"];

const STORAGE_KEY = "hyros:app-scale";
const ATTRIBUTE = "data-app-scale";

function isAppScale(value: unknown): value is AppScale {
  return value === "sm" || value === "base" || value === "lg";
}

/** Read the persisted scale (defaults to "base"). */
export function getAppScale(): AppScale {
  if (typeof window === "undefined") return "base";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isAppScale(stored) ? stored : "base";
  } catch {
    return "base";
  }
}

/** Apply the scale to <html data-app-scale> and persist the choice. */
export function setAppScale(scale: AppScale): void {
  const root = document.documentElement;
  if (scale === "base") {
    root.removeAttribute(ATTRIBUTE);
  } else {
    root.setAttribute(ATTRIBUTE, scale);
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, scale);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/**
 * Apply the persisted scale before first paint. Call once at bootstrap in
 * each app's main.tsx — the desktop CSP blocks inline scripts, so this runs
 * there instead of an index.html snippet.
 */
export function applyPersistedAppScale(): void {
  if (typeof document === "undefined") return;
  setAppScale(getAppScale());
}

/** React binding: current scale + setter, kept in sync with the document. */
export function useAppScale(): [AppScale, (scale: AppScale) => void] {
  const [scale, setScale] = useState<AppScale>(() => getAppScale());

  useEffect(() => {
    setAppScale(scale);
  }, [scale]);

  return [scale, setScale];
}
