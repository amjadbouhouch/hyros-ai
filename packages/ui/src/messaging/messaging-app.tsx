import { useEffect, useState } from "react";

import type { AgentScheduleSummary, UserProfile } from "@hyros-ai/domain";
import { cn } from "../lib/cn.js";
import { ChatDetails } from "./chat-details.js";
import { ChatList } from "./chat-list.js";
import { ChatThread } from "./chat-thread.js";
import { type Chat } from "./types.js";

interface MessagingAppProps {
  user: UserProfile;
  onSignOut?: () => void;
  /** The user's agents (chat list) — live from the chat store/API. */
  chats: Chat[];
  /** "+" is disabled while a creation request is in flight. */
  creating?: boolean;
  /** Clicked the "+" button — create a new agent. */
  onCreateAgent?: () => string | null | undefined;
  /** Send/answer a message for the active agent. */
  onSendMessage: (chatId: string, text: string) => void;
  /** A chat was selected (subscribe to its event stream). */
  onSelectChat?: (chatId: string) => void;
  /** Archive an agent while retaining its persisted profile/history. */
  onArchiveAgent?: (chatId: string) => Promise<void>;
  /** Load the read-only recurring schedules for one agent. */
  onLoadSchedules?: (chatId: string) => Promise<AgentScheduleSummary[]>;
}

/**
 * Agent messaging workspace: conversation list on the left, the active thread
 * in the center, and a toggleable details panel on the right. Presentational —
 * data arrives via props (the host app wires the chat store).
 */
export function MessagingApp({
  user,
  onSignOut,
  chats,
  creating,
  onCreateAgent,
  onSendMessage,
  onSelectChat,
  onArchiveAgent,
  onLoadSchedules,
}: MessagingAppProps) {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;

  // Auto-open (and attach to) the most recent agent on first load.
  useEffect(() => {
    if (chats.length === 0) {
      if (activeChatId !== null) setActiveChatId(null);
      return;
    }
    if (!activeChatId || !chats.some((chat) => chat.id === activeChatId)) {
      const first = chats[0]!.id;
      setActiveChatId(first);
      onSelectChat?.(first);
    }
  }, [chats, activeChatId, onSelectChat]);

  function handleSelectChat(chatId: string) {
    setActiveChatId(chatId);
    onSelectChat?.(chatId);
  }

  function handleCreateAgent() {
    const agentId = onCreateAgent?.();
    if (agentId) handleSelectChat(agentId);
  }

  function handleSendMessage(text: string) {
    if (!activeChat) return;
    onSendMessage(activeChat.id, text);
  }

  async function handleArchiveAgent(chatId: string) {
    if (!onArchiveAgent) return;
    await onArchiveAgent(chatId);
    setDetailsOpen(false);
    const nextChat = chats.find((chat) => chat.id !== chatId) ?? null;
    setActiveChatId(nextChat?.id ?? null);
    if (nextChat) onSelectChat?.(nextChat.id);
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {/* Left: conversation list (full-screen on mobile until a chat opens) */}
      <div
        className={cn(
          "w-full shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex md:w-80",
          activeChat ? "hidden md:flex" : "flex"
        )}
      >
        <ChatList
          chats={chats}
          activeChatId={activeChatId}
          onSelectChat={handleSelectChat}
          onCreateAgent={onCreateAgent ? handleCreateAgent : undefined}
          creating={creating}
          search={search}
          onSearchChange={setSearch}
          user={user}
          onSignOut={onSignOut}
        />
      </div>

      {/* Center: active thread + details panel */}
      <main
        className={cn(
          "relative min-w-0 flex-1",
          activeChat ? "flex" : "hidden md:flex"
        )}
      >
        <ChatThread
          chat={activeChat}
          detailsOpen={detailsOpen}
          onToggleDetails={() => setDetailsOpen((open) => !open)}
          onBack={() => setActiveChatId(null)}
          onSendMessage={handleSendMessage}
        />
        {detailsOpen && activeChat && (
          <aside className="absolute inset-y-0 right-0 z-10 w-full bg-sidebar text-sidebar-foreground sm:w-80 lg:static lg:z-auto lg:w-80 lg:shrink-0">
            <ChatDetails
              key={activeChat.id}
              chat={activeChat}
              onClose={() => setDetailsOpen(false)}
              onArchive={
                onArchiveAgent
                  ? () => handleArchiveAgent(activeChat.id)
                  : undefined
              }
              onLoadSchedules={onLoadSchedules}
            />
          </aside>
        )}
      </main>
    </div>
  );
}
