/**
 * Shared utility helpers for the Hyros AI platform.
 */

/** Type-safe `Object.entries` — preserves key types. */
export function entries<T extends object>(obj: T): Array<[keyof T, T[keyof T]]> {
    return Object.entries(obj) as Array<[keyof T, T[keyof T]]>;
}

/** Clamp a number into a range. */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/** Format an ISO date string into a human-readable label. */
export function formatDate(iso: string, locale = "en-US"): string {
    return new Date(iso).toLocaleDateString(locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}