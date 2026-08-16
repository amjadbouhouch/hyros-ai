import { convertMessages, type MastraDBMessage } from "@mastra/core/agent";

import type { ChatMessageDto } from "@hyros-ai/domain";

/** Convert Mastra's persisted V2 messages to the canonical AI SDK UI shape. */
export function toChatMessages(messages: MastraDBMessage[]): ChatMessageDto[] {
    const converted = convertMessages(messages).to("AIV5.UI");
    // This is a transport boundary: normalize Dates and omit undefined fields
    // exactly as the HTTP/SSE JSON encoder will, so every caller sees one shape.
    return JSON.parse(JSON.stringify(converted)) as ChatMessageDto[];
}

export function toChatMessage(message: MastraDBMessage): ChatMessageDto {
    const converted = toChatMessages([message])[0];
    if (!converted) throw new Error(`could not convert Mastra message ${message.id}`);
    return converted;
}
