import type { AgentSummary } from "@hyros-ai/api-client";
import type { AgentChatState } from "./chat-store.js";
import type { ChatThreadItem } from "./chat-messages.js";

/** UI-ready agent chat derived from gateway data plus the live chat store. */
export interface AgentChatView
    extends Pick<AgentSummary, "id" | "name" | "description" | "avatarUrl"> {
    running: AgentChatState["running"];
    pendingQuestion: AgentChatState["pendingQuestion"];
    lastMessage: AgentSummary["lastMessage"];
    /** Bubbles and collapsed agent-to-agent exchanges, in thread order. */
    messages: ChatThreadItem[];
}
