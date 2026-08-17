import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  AudioWaveform,
  MessagesSquare,
  Mic,
  PanelRight,
  Plus,
  Send,
} from "lucide-react";

import { cn } from "../lib/cn.js";
import { ChatAvatar } from "./avatar.js";
import { MessageBubble, type MessageTone } from "./message-bubble.js";
import { PeerExchangeDialog } from "./peer-exchange-dialog.js";
import { PeerExchangeRow, type AgentIdentity } from "./peer-exchange-row.js";
import { QuestionPrompt } from "./question-prompt.js";
import { type Chat, type ChatMessage, type ChatThreadItem, type PeerExchangeView } from "./types.js";
import { BubbleGroup } from "../ui/bubble.js";
import { WorkingIndicator } from "./working-indicator.js";

/** Consecutive messages from the same speaker: one turn, drawn as one group. */
interface MessageRun {
  kind: "run";
  id: string;
  messages: ChatMessage[];
}

type ThreadRow = MessageRun | PeerExchangeView;

/**
 * Group the thread into runs.
 *
 * An agent often says several things in a row — a report, then a follow-up — and
 * spacing each the same as a change of speaker loses the rhythm that tells the
 * reader who is talking. A run tightens that spacing and carries one timestamp.
 *
 * A reply breaks a run: its quote is a header, and burying that mid-run reads as
 * an interruption.
 */
function groupIntoRuns(items: ChatThreadItem[]): ThreadRow[] {
  const rows: ThreadRow[] = [];
  for (const item of items) {
    if (item.kind === "exchange") {
      rows.push(item);
      continue;
    }
    const last = rows[rows.length - 1];
    if (last?.kind === "run" && last.messages[0]!.role === item.role && !item.replyTo) {
      last.messages.push(item);
      continue;
    }
    rows.push({ kind: "run", id: item.id, messages: [item] });
  }
  return rows;
}

function toneFor(role: ChatMessage["role"]): MessageTone {
  if (role === "user") return "default";
  // Not the agent talking: something went wrong, and it should not look like an
  // ordinary reply.
  if (role === "system") return "destructive";
  return "muted";
}

interface ChatThreadProps {
  chat: Chat | null;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  /** Mobile-only: return to the conversation list. */
  onBack: () => void;
  onSendMessage: (text: string) => void;
  /**
   * Look up another of the user's agents, for the avatar and name on an exchange
   * row. Agent messages identify a peer by id when it wrote in and by name when
   * this agent wrote out, so both are offered.
   */
  resolveAgent?: (ref: { id: string | null; name: string }) => AgentIdentity | undefined;
}

/** Main area: thread header (with details toggle), messages, and composer. */
export function ChatThread({
  chat,
  detailsOpen,
  onToggleDetails,
  onBack,
  onSendMessage,
  resolveAgent,
}: ChatThreadProps) {
  const [draft, setDraft] = useState("");
  const [openExchange, setOpenExchange] = useState<PeerExchangeView | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const chatId = chat?.id ?? null;
  const messageCount = chat?.messages.length ?? 0;
  // Typing re-renders the thread, so don't regroup it on every keystroke.
  const rows = useMemo(() => groupIntoRuns(chat?.messages ?? []), [chat?.messages]);
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
    setOpenExchange(null);
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
  const self: AgentIdentity = { name: chat.name, avatarUrl: chat.avatarUrl };

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
        {/* A flex column, not `space-y`: bubbles align themselves to their own side. */}
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-28 pt-6 md:px-6">
          {rows.map((row) =>
            row.kind === "exchange" ? (
              <PeerExchangeRow
                key={row.id}
                exchange={row}
                agent={self}
                peer={resolveAgent?.(row.peer)}
                onOpen={() => setOpenExchange(row)}
              />
            ) : (
              <BubbleGroup key={row.id}>
                {row.messages.map((message, index) => {
                  const last = index === row.messages.length - 1;
                  return (
                    <MessageBubble
                      key={message.id}
                      text={message.text}
                      align={message.role === "user" ? "end" : "start"}
                      tone={toneFor(message.role)}
                      quote={
                        message.replyTo
                          ? { author: chat.name, text: message.replyTo }
                          : undefined
                      }
                      timestamp={last ? message.createdAt : undefined}
                      tail={last}
                    />
                  );
                })}
              </BubbleGroup>
            )
          )}
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

      {openExchange && (
        <PeerExchangeDialog
          exchange={openExchange}
          agent={self}
          peer={resolveAgent?.(openExchange.peer)}
          onClose={() => setOpenExchange(null)}
        />
      )}
    </div>
  );
}
