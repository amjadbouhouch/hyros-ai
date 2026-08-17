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

/**
 * Structural shape of one AI SDK UI message part — enough to read text out of
 * one, without this package taking a dependency on the message DTOs.
 */
export interface MessagePartLike {
    type?: string;
    text?: unknown;
    reasoning?: unknown;
}

/** Parts that carry no content of their own and never end a turn. */
function isBookkeepingPart(part: MessagePartLike): boolean {
    const type = part.type ?? "";
    if (type.startsWith("data-") || type.startsWith("step-")) return true;
    // A text part the model left empty is exactly what a reasoning-only turn
    // produces, so it must not count as "the turn ended in text".
    if (type === "text") return partText(part).length === 0;
    return false;
}

function partText(part: MessagePartLike): string {
    const raw = typeof part.text === "string" ? part.text : "";
    return raw.trim();
}

function reasoningText(part: MessagePartLike): string {
    // Mastra's stored v2 envelope uses `reasoning`; AI SDK UI parts use `text`.
    const raw =
        typeof part.reasoning === "string"
            ? part.reasoning
            : typeof part.text === "string"
              ? part.text
              : "";
    return raw.trim();
}

/**
 * The answer a model left in its reasoning channel, or null when it did not.
 *
 * Reasoning models sometimes deliver a whole reply inside `reasoning` and leave
 * the step's text empty — glm-4.7 does it after a run of tool calls, and the
 * result is a turn that renders as nothing at all. That content is the only copy
 * of the answer, so it has to be shown.
 *
 * Position is what separates an answer from ordinary deliberation: reasoning that
 * precedes more work is followed by a tool call or by text, while reasoning at
 * the very end of a message is where the turn stopped. So only a trailing block
 * counts, and mid-run thinking stays hidden.
 */
export function trailingReasoningText(parts: readonly MessagePartLike[]): string | null {
    for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        if (!part || typeof part !== "object") continue;
        if (isBookkeepingPart(part)) continue;
        if (part.type !== "reasoning") return null;
        const text = reasoningText(part);
        return text.length > 0 ? text : null;
    }
    return null;
}