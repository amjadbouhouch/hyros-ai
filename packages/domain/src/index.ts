/**
 * @hyros-ai/domain — shared domain types and DTOs for the Hyros AI platform.
 * This is the mobile-safe "domain" sharing scope: pure types only, no runtime,
 * no Bun/Node/DOM APIs. Consumed by the gateway, web, desktop, mobile, and CLI.
 */

export type ID = string;

export type ISODateString = string;

/** A user record as returned by the gateway. */
export interface User {
    id: ID;
    email: string;
    name: string;
    createdAt: ISODateString;
}

/** Health-check response shape. */
export interface HealthResponse {
    status: "ok" | "degraded";
    version: string;
    timestamp: ISODateString;
}

/**
 * The authenticated user's profile, as returned by the gateway's
 * `GET /auth/session`. Single source of truth for the shape that the gateway
 * produces (auth guard) and every client consumes (web, desktop, mobile).
 */
export interface UserProfile {
    id: ID;
    email: string;
    name: string;
    avatarUrl: string | null;
}

/** Read-only schedule row shown in an agent's detail panel. */
export interface AgentScheduleSummary {
    id: ID;
    name: string;
    prompt: string;
    cron: string;
    timezone: string | null;
    status: "active" | "paused";
    nextFireAt: ISODateString | null;
    lastFireAt: ISODateString | null;
}
/** App metadata carried by the standard AI SDK UIMessage wire shape. */
export interface ChatMessageMetadata {
    createdAt?: ISODateString;
    /** Links an optimistic answer to the persisted ask_user tool result. */
    pendingToolCallId?: string;
    /**
     * The ask_user question this message answers, captured client-side so a
     * live answer can quote it before the tool result is persisted.
     */
    answeredQuestion?: string;
    optimistic?: boolean;
    [key: string]: unknown;
}

/**
 * JSON-safe AI SDK UIMessage part. Mastra produces the concrete discriminated
 * variants (text, reasoning, tool-*, file, source-*, data-*, step-start).
 */
export interface ChatMessagePart {
    type: string;
    text?: string;
    toolCallId?: string;
    state?: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
    [key: string]: unknown;
}

/**
 * Canonical chat message DTO: the AI SDK UIMessage transport shape. Keep
 * rendering concerns out of this type; clients project visible bubbles from
 * parts while retaining tool/file/reasoning data losslessly.
 */
export interface ChatMessageDto {
    id: ID;
    role: "system" | "user" | "assistant";
    metadata?: ChatMessageMetadata;
    parts: ChatMessagePart[];
}

export interface ChatQuestionOption {
    label: string;
    description?: string;
}

/** The structured suspend payload emitted by Mastra's built-in ask_user. */
export interface ChatQuestion {
    toolCallId: string;
    question: string;
    options?: ChatQuestionOption[];
    selectionMode?: "single_select" | "multi_select";
}
