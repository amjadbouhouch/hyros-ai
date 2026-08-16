import { useEffect, useRef, useState } from "react";
import { ArrowLeft, MessagesSquare, PanelRight, Send } from "lucide-react";

import { cn } from "../lib/cn.js";
import { formatRelativeTime } from "../lib/relative-time.js";
import { ChatAvatar } from "./avatar.js";
import { QuestionPrompt } from "./question-prompt.js";
import { type Chat, type ChatMessage } from "./types.js";
import { WorkingIndicator } from "./working-indicator.js";

function MessageBubble({ message }: { message: ChatMessage }) {
  const mine = message.role === "user";
  return (
    <div className={cn("flex w-full", mine ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[75%]", mine && "flex flex-col items-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            mine
              ? "rounded-br-md bg-primary text-primary-foreground"
              : "rounded-bl-md bg-muted"
          )}
        >
          <p className="break-words whitespace-pre-wrap">{message.text}</p>
        </div>
        <span className="mt-1 block px-1 text-xs text-muted-foreground">
          {formatRelativeTime(message.createdAt)}
        </span>
      </div>
    </div>
  );
}

interface ChatThreadProps {
  chat: Chat | null;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  /** Mobile-only: return to the conversation list. */
  onBack: () => void;
  onSendMessage: (text: string) => void;
}

/** Main area: thread header (with details toggle), messages, and composer. */
export function ChatThread({
  chat,
  detailsOpen,
  onToggleDetails,
  onBack,
  onSendMessage,
}: ChatThreadProps) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const chatId = chat?.id ?? null;
  const messageCount = chat?.messages.length ?? 0;
  const questionId = chat?.pendingQuestion?.toolCallId ?? null;
  const running = chat?.running ?? false;

  // Keep the latest message in view when switching chats or sending.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chatId, messageCount, questionId, running]);

  // Don't leak a draft from one conversation into another.
  useEffect(() => {
    setDraft("");
  }, [chatId]);

  if (!chat) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <MessagesSquare className="size-7" />
        </span>
        <p className="text-sm text-muted-foreground">
          Select a conversation to start chatting.
        </p>
      </div>
    );
  }

  function send() {
    const text = draft.trim();
    if (!text) return;
    onSendMessage(text);
    setDraft("");
  }

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex h-16 shrink-0 items-center gap-3 bg-sidebar px-4">
        <button
          type="button"
          onClick={onBack}
          title="Back to chats"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
        >
          <ArrowLeft className="size-5" />
        </button>
        <ChatAvatar
          name={chat.name}
          url={chat.avatarUrl}
          className="size-10 text-xs"
        />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold">{chat.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {chat.description ?? "New agent"}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleDetails}
          aria-pressed={detailsOpen}
          title={detailsOpen ? "Hide details" : "Show details"}
          className={cn(
            "rounded-md p-2 transition-colors",
            detailsOpen
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <PanelRight className="size-4" />
        </button>
      </header>

      {/* Messages — full-width scroll container, constrained centered column. */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 pb-28 pt-6 md:px-6">
          {chat.messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {chat.running && (
            <WorkingIndicator name={chat.name} avatarUrl={chat.avatarUrl} />
          )}
        </div>
      </div>

      {chat.pendingQuestion && (
        <div className="relative z-10 shrink-0 px-4 pb-24 md:px-6">
          <div className="mx-auto max-w-3xl">
            <QuestionPrompt
              questionId={chat.pendingQuestion.toolCallId}
              question={chat.pendingQuestion.question}
              options={chat.pendingQuestion.options ?? []}
              onSelect={onSendMessage}
              onFreeform={() => inputRef.current?.focus()}
              onSkip={() => onSendMessage("Skip this question")}
            />
          </div>
        </div>
      )}

      {/* The translucent composer floats above messages scrolling beneath it. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-3 md:px-6 md:pb-4">
        <form
          className="pointer-events-auto mx-auto max-w-3xl"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-background/80 p-2 shadow-[0_12px_36px_-24px_oklch(0.15_0_0/0.45)] backdrop-blur-md transition-shadow focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20">
            <label htmlFor={`message-${chat.id}`} className="sr-only">
              {chat.pendingQuestion ? "Your answer" : `Message ${chat.name}`}
            </label>
            <input
              id={`message-${chat.id}`}
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                chat.pendingQuestion
                  ? chat.pendingQuestion.options?.length
                    ? "Type your own answer…"
                    : "Type your answer…"
                  : `Message ${chat.name.split(" ")[0]}…`
              }
              className="h-10 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              title="Send message"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-[opacity,transform] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95 disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none"
            >
              <Send className="size-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
