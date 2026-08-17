const DIACRITIC_MARKS = /[\u0300-\u036f]/g;
const NON_ASCII_ALPHANUMERIC = /[^a-z0-9]+/g;
const EDGE_HYPHENS = /^-+|-+$/g;

/**
 * Canonical, model-safe address derived from an agent's display name.
 *
 * Display names remain presentation data. This value is the stable routing
 * address within one user's agent directory and is persisted in `agents.slug`.
 */
export function slugifyAgentName(displayName: string): string {
    return displayName
        .normalize("NFD")
        .replace(DIACRITIC_MARKS, "")
        .trim()
        .toLowerCase()
        .replace(NON_ASCII_ALPHANUMERIC, "-")
        .replace(EDGE_HYPHENS, "");
}
