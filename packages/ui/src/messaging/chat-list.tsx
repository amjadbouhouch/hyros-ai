import { PanelLeftClose, PanelLeftOpen, Plus, Search, Settings } from "lucide-react";

import type { UserProfile } from "@hyros-ai/domain";
import { cn } from "../lib/cn.js";
import { formatRelativeTime } from "../lib/relative-time.js";
import { ChatAvatar } from "./avatar.js";
import { type Chat } from "./types.js";

interface ChatListProps {
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  /** "+" — create a new agent. */
  onCreateAgent?: () => void;
  /** Disable "+" while a creation request is in flight. */
  creating?: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  user: UserProfile;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Open account/appearance settings (where signing out lives). */
  onOpenSettings: () => void;
}

function preview(chat: Chat): string {
  const message = chat.lastMessage;
  if (!message) return "No messages yet";
  const prefix = message.role === "user" ? "You: " : "";
  return `${prefix}${message.text}`;
}

/** Left sidebar: current user, search, and the list of conversations. */
export function ChatList({
  chats,
  activeChatId,
  onSelectChat,
  onCreateAgent,
  creating,
  search,
  onSearchChange,
  user,
  collapsed,
  onToggleCollapsed,
  onOpenSettings,
}: ChatListProps) {
  const query = search.trim().toLowerCase();
  const visible = chats
    .filter((chat) => chat.name.toLowerCase().includes(query))
    .sort(
      (a, b) =>
        Number(b.running) - Number(a.running) ||
        (b.lastMessage ? Date.parse(b.lastMessage.createdAt) : 0) -
          (a.lastMessage ? Date.parse(a.lastMessage.createdAt) : 0)
    );

  return (
    <div className="flex h-full flex-col">
      {/* Current user */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center gap-3 px-4",
          collapsed && "md:justify-center md:px-0"
        )}
      >
        <ChatAvatar
          name={user.name}
          className={cn("size-9 text-xs", collapsed && "md:hidden")}
        />
        <div
          className={cn(
            "min-w-0 flex-1 leading-tight",
            collapsed && "md:hidden"
          )}
        >
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <div className={cn("flex items-center gap-0.5", collapsed && "md:flex-col")}>
          <button
            type="button"
            title="Settings"
            aria-label="Settings"
            onClick={onOpenSettings}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Settings className="size-4" />
          </button>
          <button
            type="button"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
            className="hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:block"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>
        </div>
      </div>

      {/* Search */}
      <div
        className={cn(
          "shrink-0 px-4 pt-4 pb-2",
          collapsed && "md:hidden"
        )}
      >
        <label className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search chats…"
            className="h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </label>
      </div>

      <div
        className={cn(
          "flex shrink-0 items-center justify-between px-4 pt-2 pb-1",
          collapsed && "md:justify-center md:px-0"
        )}
      >
        <p
          className={cn(
            "text-xs font-semibold tracking-widest text-muted-foreground uppercase",
            collapsed && "md:hidden"
          )}
        >
          Agents
        </p>
        {onCreateAgent && (
          <button
            type="button"
            onClick={onCreateAgent}
            disabled={creating}
            title="Create a new agent"
            aria-label="Create a new agent"
            className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>

      {/* Conversations, most recent first */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            No conversations found.
          </p>
        ) : (
          visible.map((chat) => {
            const message = chat.lastMessage;
            const active = chat.id === activeChatId;
            return (
              <button
                key={chat.id}
                type="button"
                onClick={() => onSelectChat(chat.id)}
                title={collapsed ? chat.name : undefined}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors",
                  collapsed && "md:justify-center md:px-0",
                  active ? "bg-muted" : "hover:bg-muted/60"
                )}
              >
                <ChatAvatar
                  name={chat.name}
                  url={chat.avatarUrl}
                  className="size-11 text-xs"
                />
                {/* The rail hides the name visually at md+, which would leave
                    the row unnamed for assistive tech — keep it readable. */}
                {collapsed && (
                  <span className="sr-only hidden md:inline">{chat.name}</span>
                )}
                <span
                  className={cn(
                    "min-w-0 flex-1",
                    collapsed && "md:hidden"
                  )}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {chat.name}
                    </span>
                    {message && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRelativeTime(message.createdAt)}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {preview(chat)}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </nav>
    </div>
  );
}
