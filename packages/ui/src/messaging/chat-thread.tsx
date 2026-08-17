import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  AudioWaveform,
  MessagesSquare,
  Mic,
  PanelRight,
  Plus,
  Reply,
  Send,
} from "lucide-react";

import { cn } from "../lib/cn.js";
import { formatRelativeTime } from "../lib/relative-time.js";
import { ChatAvatar } from "./avatar.js";
import { QuestionPrompt } from "./question-prompt.js";
import { type Chat, type ChatMessage } from "./types.js";
import { WorkingIndicator } from "./working-indicator.js";

function MessageBubble({
  message,
  agentName,
}: {
  message: ChatMessage;
  agentName: string;
}) {
  const mine = message.role === "user";
  const quotedQuestion = mine ? message.answeredQuestion : undefined;
  return (
    <div className={cn("flex w-full", mine ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[75%]", mine && "flex flex-col items-end")}>
        {/* An answer to ask_user reads as a bare fragment on its own, so the
            question sits above it in the agent's own bubble — a reply, as a
            chat app renders one. */}
        {quotedQuestion && (
          <div className="flex max-w-full flex-col items-end pr-2">
            <span className="mb-1 flex items-center gap-1 px-1 text-xs text-muted-foreground">
              <Reply aria-hidden="true" className="size-3" />
              {agentName}
            </span>
            <div className="-mb-2 max-w-full rounded-2xl bg-muted px-4 pb-3.5 pt-2 text-sm leading-relaxed text-muted-foreground">
              <p className="line-clamp-2 break-words">{quotedQuestion}</p>
            </div>
          </div>
        )}
        <div
          className={cn(
            "relative rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const chatId = chat?.id ?? null;
  const messageCount = chat?.messages.length ?? 0;
  const questionId = chat?.pendingQuestion?.toolCallId ?? null;
  const running = chat?.running ?? false;

  // Keep the latest message in view when switching chats or sending.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chatId, messageCount, questionId, running]);

  // Don't leak a draft from one conversation into another. The auto-grow height
  // is an inline style, so it has to be cleared with the text.
  useEffect(() => {
    setDraft("");
    if (inputRef.current) inputRef.current.style.height = "auto";
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
    if (inputRef.current) inputRef.current.style.height = "auto";
  }

  function updateDraft(value: string) {
    setDraft(value);
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 208)}px`;
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // While an IME is composing (Japanese/Chinese/Korean input), Enter commits
    // the candidate — sending there would ship a half-typed message.
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  const composerExpanded = draft.length > 100 || draft.includes("\n");

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
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{chat.name}</p>
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
            <MessageBubble
              key={message.id}
              message={message}
              agentName={chat.name}
            />
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
          <div
            className="grid overflow-hidden rounded-3xl border border-border bg-background/85 p-2.5 shadow-[0_14px_38px_-24px_oklch(0.15_0_0/0.5)] backdrop-blur-md focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20"
            style={
              composerExpanded
                ? {
                    gridTemplateAreas: '"primary primary" "leading trailing"',
                    gridTemplateColumns: "1fr auto",
                  }
                : {
                    gridTemplateAreas: '"leading primary trailing"',
                    gridTemplateColumns: "auto minmax(0, 1fr) auto",
                  }
            }
          >
            <div className="flex items-end" style={{ gridArea: "leading" }}>
              <button
                type="button"
                disabled
                title="Attachments coming soon"
                aria-label="Add attachments (coming soon)"
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground disabled:cursor-default disabled:opacity-100"
              >
                <Plus className="size-5" />
              </button>
            </div>

            <div
              className="flex min-h-10 min-w-0 items-center px-1.5"
              style={{ gridArea: "primary" }}
            >
              <label htmlFor={`message-${chat.id}`} className="sr-only">
                {chat.pendingQuestion ? "Your answer" : `Message ${chat.name}`}
              </label>
              <textarea
                id={`message-${chat.id}`}
                ref={inputRef}
                rows={1}
                value={draft}
                onChange={(event) => updateDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={
                  chat.pendingQuestion
                    ? chat.pendingQuestion.options?.length
                      ? "Type your own answer…"
                      : "Type your answer…"
                    : "Ask anything"
                }
                className="max-h-52 min-h-6 w-full resize-none overflow-y-auto bg-transparent py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div
              className="ml-auto flex items-end gap-0.5"
              style={{ gridArea: "trailing" }}
            >
              <button
                type="button"
                disabled
                title="Voice input coming soon"
                aria-label="Record audio (coming soon)"
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground disabled:cursor-default disabled:opacity-100"
              >
                <Mic className="size-5" />
              </button>
              <button
                type="button"
                disabled
                title="Audio mode coming soon"
                aria-label="Audio mode (coming soon)"
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground disabled:cursor-default disabled:opacity-100"
              >
                <AudioWaveform className="size-5" />
              </button>
              {draft.trim() && (
                <button
                  type="submit"
                  title="Send message"
                  aria-label="Send message"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-[opacity,transform] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95 motion-reduce:transition-none"
                >
                  <Send className="size-4" />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
