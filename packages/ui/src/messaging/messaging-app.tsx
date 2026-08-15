import { useState } from "react";

import type { UserProfile } from "@hyros-ai/domain";
import { cn } from "../lib/cn.js";
import { ChatDetails } from "./chat-details.js";
import { ChatList } from "./chat-list.js";
import { ChatThread } from "./chat-thread.js";
import { MOCK_CHATS } from "./data.js";
import { CURRENT_USER_ID, type Chat } from "./types.js";

interface MessagingAppProps {
  user: UserProfile;
  onSignOut?: () => void;
}

/**
 * User-to-user messaging workspace: conversation list on the left, the active
 * thread in the center, and a toggleable details panel on the right. Runs on
 * mock data until messaging is wired to the gateway.
 */
export function MessagingApp({ user, onSignOut }: MessagingAppProps) {
  const [chats, setChats] = useState<Chat[]>(MOCK_CHATS);
  const [activeChatId, setActiveChatId] = useState<number | null>(
    MOCK_CHATS[0]?.id ?? null
  );
  const [search, setSearch] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;

  function handleSendMessage(text: string) {
    if (!activeChat) return;
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === activeChat.id
          ? {
              ...chat,
              messages: [
                ...chat.messages,
                {
                  id: Date.now(),
                  senderId: CURRENT_USER_ID,
                  text,
                  createdAt: new Date(),
                },
              ],
            }
          : chat
      )
    );
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
          onSelectChat={setActiveChatId}
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
              chat={activeChat}
              onClose={() => setDetailsOpen(false)}
            />
          </aside>
        )}
      </main>
    </div>
  );
}
