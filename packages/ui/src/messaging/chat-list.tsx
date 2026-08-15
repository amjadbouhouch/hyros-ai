import { CaseSensitive, LogOut, Search } from "lucide-react";

import type { UserProfile } from "@hyros-ai/domain";
import {
  APP_SCALES,
  useAppScale,
  type AppScale,
} from "../lib/app-scale.js";
import { cn } from "../lib/cn.js";
import { formatRelativeTime } from "../lib/relative-time.js";
import { ChatAvatar } from "./avatar.js";
import { CURRENT_USER_ID, type Chat } from "./types.js";

const SCALE_LABELS: Record<AppScale, string> = {
  sm: "Small",
  base: "Default",
  lg: "Large",
};

interface ChatListProps {
  chats: Chat[];
  activeChatId: number | null;
  onSelectChat: (chatId: number) => void;
  search: string;
  onSearchChange: (value: string) => void;
  user: UserProfile;
  onSignOut?: () => void;
}

function lastMessage(chat: Chat) {
  return chat.messages[chat.messages.length - 1];
}

function preview(chat: Chat): string {
  const message = lastMessage(chat);
  if (!message) return "No messages yet";
  const prefix = message.senderId === CURRENT_USER_ID ? "You: " : "";
  return `${prefix}${message.text}`;
}

/** Left sidebar: current user, search, and the list of conversations. */
export function ChatList({
  chats,
  activeChatId,
  onSelectChat,
  search,
  onSearchChange,
  user,
  onSignOut,
}: ChatListProps) {
  const [appScale, setAppScale] = useAppScale();

  function cycleAppScale() {
    const next =
      APP_SCALES[(APP_SCALES.indexOf(appScale) + 1) % APP_SCALES.length]!;
    setAppScale(next);
  }

  const query = search.trim().toLowerCase();
  const visible = chats
    .filter((chat) => chat.name.toLowerCase().includes(query))
    .sort(
      (a, b) =>
        (lastMessage(b)?.createdAt.getTime() ?? 0) -
        (lastMessage(a)?.createdAt.getTime() ?? 0)
    );

  return (
    <div className="flex h-full flex-col">
      {/* Current user */}
      <div className="flex h-16 shrink-0 items-center gap-3 px-4">
        <ChatAvatar name={user.name} className="size-9 text-xs" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={cycleAppScale}
            title={`UI scale: ${SCALE_LABELS[appScale]} (click to change)`}
            aria-label={`UI scale: ${SCALE_LABELS[appScale]} (click to change)`}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <CaseSensitive className="size-4" />
          </button>
          {onSignOut && (
            <button
              type="button"
              title="Sign out"
              onClick={onSignOut}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 px-4 pt-4 pb-2">
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

      <p className="shrink-0 px-4 pt-2 pb-1 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        Messages
      </p>

      {/* Conversations, most recent first */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            No conversations found.
          </p>
        ) : (
          visible.map((chat) => {
            const message = lastMessage(chat);
            const active = chat.id === activeChatId;
            return (
              <button
                key={chat.id}
                type="button"
                onClick={() => onSelectChat(chat.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors",
                  active ? "bg-muted" : "hover:bg-muted/60"
                )}
              >
                <ChatAvatar
                  name={chat.name}
                  status={chat.status}
                  className="size-11 text-xs"
                />
                <span className="min-w-0 flex-1">
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
