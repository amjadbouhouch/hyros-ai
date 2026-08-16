import type { ChatMessageDto, ChatMessagePart } from "@hyros-ai/domain";

export interface ChatMessageView {
    id: string;
    role: "user" | "assistant";
    text: string;
    createdAt: string;
}

export function messageCreatedAt(message: ChatMessageDto): string {
    return typeof message.metadata?.createdAt === "string"
        ? message.metadata.createdAt
        : new Date(0).toISOString();
}

function askUserAnswer(part: ChatMessagePart): string | null {
    if (part.type !== "tool-ask_user" || part.state !== "output-available") return null;
    const output = part.output;
    const content =
        typeof output === "string"
            ? output
            : output && typeof output === "object"
              ? (output as { content?: unknown }).content
              : null;
    if (typeof content !== "string") return null;
    return content.replace(/^User answered:\s*/i, "").trim() || null;
}

/**
 * Convert canonical AI SDK UI messages into simple visual bubbles. Tool state
 * remains in the canonical store; completed ask_user results are projected as
 * user bubbles so suspension answers survive a reload.
 */
export function projectChatMessages(messages: ChatMessageDto[]): ChatMessageView[] {
    const optimisticToolAnswers = new Set(
        messages
            .filter((message) => message.role === "user")
            .map((message) => message.metadata?.pendingToolCallId)
            .filter((id): id is string => typeof id === "string"),
    );
    const views: ChatMessageView[] = [];

    for (const message of messages) {
        const createdAt = messageCreatedAt(message);
        let textPartIndex = 0;
        for (const part of message.parts) {
            if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
                views.push({
                    id: textPartIndex === 0 ? message.id : `${message.id}:text:${textPartIndex}`,
                    role: message.role === "user" ? "user" : "assistant",
                    text: part.text,
                    createdAt,
                });
                textPartIndex += 1;
                continue;
            }
            const answer = askUserAnswer(part);
            if (!answer || (part.toolCallId && optimisticToolAnswers.has(part.toolCallId))) continue;
            views.push({
                id: `${message.id}:${part.toolCallId ?? "ask_user"}:answer`,
                role: "user",
                text: answer,
                createdAt,
            });
        }
    }
    return views;
}
