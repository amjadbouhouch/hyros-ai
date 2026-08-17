import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { formatRelativeTime } from "../src/lib/relative-time.js";
import { ChatThread } from "../src/messaging/chat-thread.js";
import type { Chat } from "../src/messaging/types.js";

/**
 * These assert the `data-*` attributes the shadcn bubble primitive exposes —
 * `data-slot`, `data-variant`, `data-align` — not Tailwind classes. The classes
 * are an implementation detail that `cn` is free to reorder; the attributes are
 * the component's contract.
 */

function chatWith(messages: Chat["messages"]): Chat {
  return {
    id: "agent-1",
    name: "Scout",
    description: "Research agent",
    avatarUrl: null,
    running: false,
    pendingQuestion: null,
    lastMessage: null,
    messages,
  };
}

function render(messages: Chat["messages"]): string {
  return renderToStaticMarkup(
    <ChatThread
      chat={chatWith(messages)}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onBack={() => {}}
      onSendMessage={() => {}}
    />
  );
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

const at = (seconds: number) =>
  `2026-08-16T00:00:${String(seconds).padStart(2, "0")}.000Z`;

test("draws consecutive messages from one speaker as a single group", () => {
  const html = render([
    { kind: "message", id: "a-1", role: "assistant", text: "Working on it.", createdAt: at(1) },
    { kind: "message", id: "a-2", role: "assistant", text: "Done — see above.", createdAt: at(2) },
    { kind: "message", id: "u-1", role: "user", text: "Thanks", createdAt: at(3) },
  ]);

  // Two turns, two groups: the agent's run, then the user's reply.
  expect(count(html, 'data-slot="bubble-group"')).toBe(2);
  expect(count(html, 'data-slot="bubble"')).toBe(3);
  expect(html).toContain('data-align="end"');
  expect(html).toContain('data-align="start"');
});

test("gives a run one timestamp, on its last message", () => {
  const html = render([
    { kind: "message", id: "a-1", role: "assistant", text: "First", createdAt: at(1) },
    { kind: "message", id: "a-2", role: "assistant", text: "Second", createdAt: at(2) },
  ]);

  // A run is one turn; stamping every bubble repeated the same time twice.
  const stamp = formatRelativeTime(at(2));
  expect(count(html, `>${stamp}<`)).toBe(1);
  expect(html.indexOf("Second")).toBeLessThan(html.indexOf(`>${stamp}<`));
});

test("starts a new group at a reply, so its quote reads as a header", () => {
  const html = render([
    { kind: "message", id: "u-1", role: "user", text: "Writing", createdAt: at(1) },
    {
      kind: "message",
      id: "u-2",
      role: "user",
      text: "Formal",
      createdAt: at(2),
      replyTo: "What tone should I use?",
    },
  ]);

  expect(count(html, 'data-slot="bubble-group"')).toBe(2);
  expect(html).toContain("What tone should I use?");
});

test("marks a failed run as a failure rather than an ordinary reply", () => {
  const html = render([
    { kind: "message", id: "a-1", role: "assistant", text: "On it.", createdAt: at(1) },
    { kind: "message", id: "error:1", role: "system", text: "agent run failed", createdAt: at(2) },
  ]);

  expect(html).toContain('data-variant="destructive"');
  expect(html).toContain("agent run failed");
  // Not the agent's voice, so it never joins the agent's run.
  expect(count(html, 'data-slot="bubble-group"')).toBe(2);
});

test("keeps the user on the near side and the agent on the far side", () => {
  const html = render([
    { kind: "message", id: "u-1", role: "user", text: "Hello", createdAt: at(1) },
  ]);

  expect(html).toContain('data-align="end"');
  expect(html).toContain('data-variant="default"');
  expect(html).not.toContain('data-align="start"');
});
