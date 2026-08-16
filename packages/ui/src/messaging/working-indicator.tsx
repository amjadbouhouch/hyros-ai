import { Shimmer } from "../ai-elements/shimmer.js";
import { ChatAvatar } from "./avatar.js";

interface WorkingIndicatorProps {
  name: string;
  avatarUrl?: string | null;
}

/** Compact live status shown immediately above the conversation composer. */
export function WorkingIndicator({ name, avatarUrl }: WorkingIndicatorProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`${name} is working`}
      className="px-1 py-1"
    >
      <span aria-hidden="true" className="flex items-center gap-2.5">
        <ChatAvatar
          name={name}
          url={avatarUrl}
          className="size-7 text-[0.625rem]"
        />
        <Shimmer
          as="span"
          duration={2}
          spread={1.5}
          className="text-xs font-medium tracking-[-0.01em]"
        >
          {`${name} is working…`}
        </Shimmer>
      </span>
    </div>
  );
}
