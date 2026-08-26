import { convertMessages, type MastraDBMessage } from "@mastra/core/agent";

import type { ChatMessageDto } from "@hyros-ai/domain";

/**
 * The model's thinking is internal. Stripping at this transport boundary means
 * reasoning can never cross the wire — no live flash in a thread, no monologue
 * in a chat-list preview — while Mastra's persisted history stays lossless for
 * debugging.
 */
function withoutReasoning(dto: ChatMessageDto): ChatMessageDto {
    return { ...dto, parts: dto.parts.filter((part) => part.type !== "reasoning") };
}

/** Convert Mastra's persisted V2 messages to the canonical AI SDK UI shape. */
export function toChatMessages(messages: MastraDBMessage[]): ChatMessageDto[] {
    const converted = convertMessages(messages).to("AIV5.UI");
    // This is a transport boundary: drop reasoning parts, then normalize Dates
    // and omit undefined fields exactly as the HTTP/SSE JSON encoder will, so
    // every caller sees one shape.
    return (JSON.parse(JSON.stringify(converted)) as ChatMessageDto[]).map(withoutReasoning);
}

export function toChatMessage(message: MastraDBMessage): ChatMessageDto {
    const converted = toChatMessages([message])[0];
    if (!converted) throw new Error(`could not convert Mastra message ${message.id}`);
    return converted;
}

/**
 * Whether a converted message still carries anything a client should render.
 * A turn that was only thinking has no parts left once reasoning is stripped —
 * it is never sent (live) and never replayed (history).
 */
export function isWireWorthy(message: ChatMessageDto): boolean {
    return message.parts.length > 0;
}
