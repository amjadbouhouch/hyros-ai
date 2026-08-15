import { cn } from "../lib/cn.js";
import type { ChatStatus } from "./types.js";

const AVATAR_COLORS = [
  "bg-primary/15 text-primary",
  "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
] as const;

const STATUS_COLORS: Record<ChatStatus, string> = {
  online: "bg-emerald-500",
  busy: "bg-red-500",
  away: "bg-amber-400",
  offline: "bg-zinc-400",
};

export function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Deterministic color per name so avatars stay stable across renders. */
function colorFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

interface ChatAvatarProps {
  name: string;
  status?: ChatStatus;
  /** Size + text classes, e.g. "size-10 text-xs". */
  className?: string;
}

/** Initials avatar with an optional presence dot. */
export function ChatAvatar({ name, status, className }: ChatAvatarProps) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn(
          "flex size-full items-center justify-center rounded-full font-semibold",
          colorFor(name)
        )}
      >
        {initials(name) || "?"}
      </span>
      {status && (
        <span
          className={cn(
            "absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-background",
            STATUS_COLORS[status]
          )}
        />
      )}
    </span>
  );
}
