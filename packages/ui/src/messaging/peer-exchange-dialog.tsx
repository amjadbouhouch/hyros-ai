import { useEffect } from "react";
import { X } from "lucide-react";

import { formatRelativeTime } from "../lib/relative-time.js";
import { ChatAvatar } from "./avatar.js";
import { MessageBubble } from "./message-bubble.js";
import { exchangeTitle, type AgentIdentity } from "./peer-exchange-row.js";
import type { PeerExchangeView } from "./types.js";

interface PeerExchangeDialogProps {
  exchange: PeerExchangeView;
  /** This thread's agent — its messages sit on the right. */
  agent: AgentIdentity;
  peer?: AgentIdentity;
  onClose: () => void;
}

/**
 * The conversation behind one exchange row.
 *
 * A modal rather than the details panel: that panel describes the agent, and this
 * is a conversation to read — it wants the width and it should close back to
 * exactly where the user was.
 */
export function PeerExchangeDialog({ exchange, agent, peer, onClose }: PeerExchangeDialogProps) {
  const peerName = peer?.name ?? exchange.peer.name;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="peer-exchange-title"
        className="relative flex max-h-[80dvh] w-full max-w-lg flex-col rounded-2xl border border-border bg-background text-foreground shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span aria-hidden="true" className="flex shrink-0 items-center">
            <ChatAvatar name={agent.name} url={agent.avatarUrl} className="size-8 text-xs" />
            <ChatAvatar
              name={peerName}
              url={peer?.avatarUrl ?? null}
              className="-ml-2 size-8 text-xs ring-2 ring-background"
            />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="peer-exchange-title" className="truncate text-sm font-semibold">
              {exchangeTitle(exchange.messages, agent.name, peerName)}
            </h2>
            <p className="text-xs text-muted-foreground">
              {exchange.messages.length}{" "}
              {exchange.messages.length === 1 ? "message" : "messages"} · last{" "}
              {formatRelativeTime(exchange.updatedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close the conversation"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          {exchange.messages.map((message) => {
            const mine = message.author === "agent";
            return (
              <MessageBubble
                key={message.id}
                text={message.text}
                align={mine ? "end" : "start"}
                // The thread's own agent keeps the accent it has everywhere else;
                // the other agent stays neutral.
                tone={mine ? "default" : "muted"}
                author={mine ? agent.name : peerName}
                timestamp={message.createdAt}
                className="max-w-[85%]"
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
