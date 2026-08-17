import type { ReactNode } from "react";
import { Reply } from "lucide-react";

import { cn } from "../lib/cn.js";
import { formatRelativeTime } from "../lib/relative-time.js";
import { Bubble, BubbleContent } from "../ui/bubble.js";

/**
 * How a message is coloured. A subset of the primitive's variants — the ones this
 * app has a meaning for.
 */
export type MessageTone = "default" | "muted" | "destructive";

export interface MessageBubbleProps {
  text: string;
  /** `end` is the near side: the user in a thread, this agent in an exchange. */
  align: "start" | "end";
  tone?: MessageTone;
  /** Speaker's name above the bubble, where who is talking isn't obvious. */
  author?: string;
  /** What this message answers, quoted above it and attributed. */
  quote?: { author: string; text: string };
  /**
   * Shown below the bubble. Omitted mid-run: a run of consecutive messages is one
   * turn, so only its last bubble carries the time.
   */
  timestamp?: string;
  /**
   * Notch the near corner. Only the last bubble of a run gets one, so a run reads
   * as a single shape with one tail rather than a stack of identical boxes.
   */
  tail?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * One message, in the app's bubble shape.
 *
 * Colour and alignment come from the shadcn `Bubble` primitive; the radius, the
 * tail notch and the reply quote are ours. Both places that show a message — the
 * thread and an exchange dialog — go through here, so a change to the shape lands
 * in both.
 */
export function MessageBubble({
  text,
  align,
  tone = "default",
  author,
  quote,
  timestamp,
  tail = true,
  className,
  children,
}: MessageBubbleProps) {
  const end = align === "end";
  return (
    <Bubble variant={tone} align={align} className={cn("max-w-[75%]", className)}>
      {author && (
        <span className={cn("px-1 text-xs text-muted-foreground", end && "self-end")}>
          {author}
        </span>
      )}

      {/* An answer to ask_user reads as a bare fragment on its own, so the question
          sits above it in the agent's own bubble — a reply, as a chat app renders
          one. It tucks under the answer, which is why it overlaps. */}
      {quote && (
        <div
          className={cn(
            "flex max-w-full flex-col pr-2",
            end ? "items-end self-end" : "items-start"
          )}
        >
          <span className="mb-1 flex items-center gap-1 px-1 text-xs text-muted-foreground">
            <Reply aria-hidden="true" className="size-3" />
            {quote.author}
          </span>
          <div className="-mb-3 max-w-full rounded-2xl bg-muted px-4 pb-3.5 pt-2 text-sm leading-relaxed text-muted-foreground">
            <p className="line-clamp-2 break-words">{quote.text}</p>
          </div>
        </div>
      )}

      <BubbleContent
        className={cn(
          "rounded-2xl px-4 py-2.5",
          tail && (end ? "rounded-br-md" : "rounded-bl-md")
        )}
      >
        <p className="break-words whitespace-pre-wrap">{text}</p>
      </BubbleContent>

      {timestamp && (
        <span className={cn("px-1 text-xs text-muted-foreground", end && "self-end")}>
          {formatRelativeTime(timestamp)}
        </span>
      )}
      {children}
    </Bubble>
  );
}
