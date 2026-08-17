import { cn } from "../lib/cn.js";
import { ChatAvatar } from "./avatar.js";
import type { PeerExchangeView } from "./types.js";

export interface AgentIdentity {
  name: string;
  avatarUrl: string | null;
}

/**
 * How to name a conversation, given who actually spoke.
 *
 * `↔` claims both agents took part, so it is only used when both did. Agents
 * often send with no reply requested — one writes, the other reports to its own
 * user and never answers — and calling that an exchange hides the thing worth
 * knowing: nobody replied.
 */
export function exchangeTitle(
  messages: ReadonlyArray<{ author: "agent" | "peer" }>,
  agentName: string,
  peerName: string,
): string {
  const fromAgent = messages.some((message) => message.author === "agent");
  const fromPeer = messages.some((message) => message.author === "peer");
  if (fromAgent && fromPeer) return `${agentName} ↔ ${peerName}`;
  return fromAgent ? `${agentName} → ${peerName}` : `${peerName} → ${agentName}`;
}

interface PeerExchangeRowProps {
  exchange: PeerExchangeView;
  /** This thread's agent — the near half of the pair. */
  agent: AgentIdentity;
  /** The other agent, when the host app could identify it. */
  peer?: AgentIdentity;
  onOpen: () => void;
}

/**
 * Two agents' conversation, as a divider across the thread.
 *
 * A card carried the same rounded-box language as a message bubble, which made
 * something *about* the conversation compete with what was said in it. A divider
 * reads as what this is: a mark on the timeline, where the agents stepped away and
 * talked. The rule stretches out so the eye passes over it instead of stopping.
 *
 * What the two said is behind it, so the summary stays to a count. No preview, no
 * timestamp — the messages either side of it already carry the time.
 */
export function PeerExchangeRow({ exchange, agent, peer, onOpen }: PeerExchangeRowProps) {
  const peerName = peer?.name ?? exchange.peer.name;
  const count = exchange.messages.length;
  const title = exchangeTitle(exchange.messages, agent.name, peerName);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open the conversation between ${agent.name} and ${peerName} (${count} ${
        count === 1 ? "message" : "messages"
      })`}
      className={cn(
        "group flex w-full items-center gap-2 py-1 text-left",
        "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      )}
    >
      {/* Overlapped, so the pair reads as one unit rather than two agents. */}
      <span aria-hidden="true" className="flex shrink-0 items-center">
        <ChatAvatar name={agent.name} url={agent.avatarUrl} className="size-5 text-[0.5rem]" />
        <ChatAvatar
          name={peerName}
          url={peer?.avatarUrl ?? null}
          className="-ml-1.5 size-5 text-[0.5rem] ring-2 ring-background"
        />
      </span>

      <span className="shrink-0 truncate text-xs text-muted-foreground transition-colors group-hover:text-foreground">
        <span className="font-medium">{title}</span>
        <span aria-hidden="true"> · </span>
        {count} {count === 1 ? "message" : "messages"}
      </span>

      {/* Carries the eye to the edge, the way a date separator does. */}
      <span
        aria-hidden="true"
        className="h-px min-w-4 flex-1 bg-border transition-colors group-hover:bg-muted-foreground/40"
      />
    </button>
  );
}
