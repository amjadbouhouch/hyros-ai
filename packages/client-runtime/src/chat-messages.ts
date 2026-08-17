import type { ChatMessageDto, ChatMessagePart } from "@hyros-ai/domain";
import { trailingReasoningText } from "@hyros-ai/utils";

export interface ChatMessageView {
    id: string;
    role: "user" | "assistant";
    text: string;
    createdAt: string;
    /**
     * The agent's ask_user question this bubble answers. Present only on user
     * bubbles that resolved a question, so the UI can quote it like a reply.
     */
    answeredQuestion?: string;
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

/** The question text an ask_user call asked, from its tool input. */
function askUserQuestion(part: ChatMessagePart): string | null {
    if (part.type !== "tool-ask_user") return null;
    const input = part.input;
    if (!input || typeof input !== "object") return null;
    const question = (input as { question?: unknown }).question;
    return typeof question === "string" && question.trim() ? question.trim() : null;
}

/** Question text per ask_user tool call, in any tool state. */
function questionsByToolCallId(messages: ChatMessageDto[]): Map<string, string> {
    const questions = new Map<string, string>();
    for (const message of messages) {
        for (const part of message.parts) {
            const question = askUserQuestion(part);
            if (question && part.toolCallId) questions.set(part.toolCallId, question);
        }
    }
    return questions;
}

/**
 * Convert canonical AI SDK UI messages into simple visual bubbles. Tool state
 * remains in the canonical store; completed ask_user results are projected as
 * user bubbles so suspension answers survive a reload. An answer carries the
 * question it resolved so the thread can render it as a reply.
 */
export function projectChatMessages(messages: ChatMessageDto[]): ChatMessageView[] {
    const optimisticToolAnswers = new Set(
        messages
            .filter((message) => message.role === "user")
            .map((message) => message.metadata?.pendingToolCallId)
            .filter((id): id is string => typeof id === "string"),
    );
    const questions = questionsByToolCallId(messages);
    const views: ChatMessageView[] = [];

    for (const message of messages) {
        const createdAt = messageCreatedAt(message);
        const pendingToolCallId = message.metadata?.pendingToolCallId;
        // A live answer quotes the question from the store; after a reload the
        // question comes from the persisted tool call itself.
        const answeredQuestion =
            (pendingToolCallId ? questions.get(pendingToolCallId) : undefined) ??
            message.metadata?.answeredQuestion;
        let textPartIndex = 0;
        for (const part of message.parts) {
            if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
                views.push({
                    id: textPartIndex === 0 ? message.id : `${message.id}:text:${textPartIndex}`,
                    role: message.role === "user" ? "user" : "assistant",
                    text: part.text,
                    createdAt,
                    ...(message.role === "user" && textPartIndex === 0 && answeredQuestion
                        ? { answeredQuestion }
                        : {}),
                });
                textPartIndex += 1;
                continue;
            }
            const answer = askUserAnswer(part);
            if (!answer || (part.toolCallId && optimisticToolAnswers.has(part.toolCallId))) continue;
            const question = part.toolCallId ? questions.get(part.toolCallId) : undefined;
            views.push({
                id: `${message.id}:${part.toolCallId ?? "ask_user"}:answer`,
                role: "user",
                text: answer,
                createdAt,
                ...(question ? { answeredQuestion: question } : {}),
            });
        }

        // A turn that ends thinking rather than speaking: the reasoning block is
        // the only copy of the answer, so show it instead of dropping the turn.
        // Reasoning that leads into more work is skipped — see the helper.
        if (message.role === "assistant") {
            const trailing = trailingReasoningText(message.parts);
            if (trailing) {
                views.push({
                    id: `${message.id}:reasoning`,
                    role: "assistant",
                    text: trailing,
                    createdAt,
                });
            }
        }
    }
    return views;
}
