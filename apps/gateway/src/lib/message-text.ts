import { trailingReasoningText, type MessagePartLike } from "@hyros-ai/utils";

/**
 * Assistant/user message content arrives as a plain string, a parts array, or a
 * format-v2 envelope ({ format: 2, parts: [...] }) — flatten to text.
 * (Envelope shape verified against mastra_messages rows in Postgres.)
 *
 * A turn that ends in a reasoning block resolves to that block: a reasoning model
 * sometimes leaves its whole answer there and emits no text, and this is what
 * feeds the chat list's preview, which should show the last thing an agent said.
 */
export function messageText(content: unknown): string {
    if (typeof content === "string") {
        try {
            return messageText(JSON.parse(content));
        } catch {
            return content;
        }
    }
    const parts = Array.isArray(content)
        ? content
        : (content as { parts?: unknown[] } | null)?.parts;
    if (!Array.isArray(parts)) return "";

    const trailing = trailingReasoningText(parts as MessagePartLike[]);
    if (trailing) return trailing;

    return parts
        .filter((p) => p && typeof p === "object" && (p as { type?: string }).type === "text")
        .map((p) => String((p as { text?: unknown }).text ?? ""))
        .join("");
}
