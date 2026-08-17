import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatThread } from "../src/messaging/chat-thread.js";
import { PeerExchangeDialog } from "../src/messaging/peer-exchange-dialog.js";
import type { Chat, PeerExchangeView } from "../src/messaging/types.js";

const exchange: PeerExchangeView = {
  kind: "exchange",
  id: "exchange:in-1",
  peer: { id: "orbit-id", name: "Orbit" },
  createdAt: "2026-08-17T16:43:15.000Z",
  updatedAt: "2026-08-17T16:43:30.000Z",
  messages: [
    {
      id: "in-1",
      author: "peer",
      text: "Hi Scout! I'm Orbit, your new teammate.",
      createdAt: "2026-08-17T16:43:15.000Z",
    },
    {
      id: "out-1",
      author: "agent",
      text: "Welcome aboard — I'll send you the brief.",
      createdAt: "2026-08-17T16:43:30.000Z",
    },
  ],
};

function threadWith(messages: Chat["messages"]): Chat {
  return {
    id: "scout-id",
    name: "Scout",
    description: "Research agent",
    avatarUrl: null,
    running: false,
    pendingQuestion: null,
    lastMessage: null,
    messages,
  };
}

test("collapses an exchange into one row instead of stacked quotes", () => {
  const html = renderToStaticMarkup(
    <ChatThread
      chat={threadWith([
        exchange,
        {
          kind: "message",
          id: "a-2",
          role: "assistant",
          text: "Orbit introduced themselves — project coordination.",
          createdAt: "2026-08-17T16:43:35.000Z",
        },
      ])}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onBack={() => {}}
      onSendMessage={() => {}}
    />
  );

  // A divider naming both agents and how much they said — nothing more.
  expect(html).toContain("Scout ↔ Orbit");
  expect(html).toContain("2 messages");
  expect(html).toContain(
    'aria-label="Open the conversation between Scout and Orbit (2 messages)"'
  );

  // What they said lives behind it, so neither message appears in the thread —
  // and the agent's own report to the user is still a bubble.
  expect(html).not.toContain("Hi Scout! I&#x27;m Orbit, your new teammate.");
  expect(html).not.toContain("Welcome aboard");
  expect(html).toContain("Orbit introduced themselves");
  // Closed by default: the conversation only opens on click.
  expect(html).not.toContain('role="dialog"');
});

test("names a one-way conversation with an arrow, not an exchange", () => {
  // Orbit sent Scout two notifications with no reply requested, and Scout
  // reported to its own user instead of answering. Calling that "Scout ↔ Orbit"
  // claimed a dialogue that never happened.
  const oneWay: PeerExchangeView = {
    ...exchange,
    messages: [
      { ...exchange.messages[0]!, author: "peer" },
      { ...exchange.messages[1]!, author: "peer", text: "Following up on that." },
    ],
  };
  const html = renderToStaticMarkup(
    <ChatThread
      chat={threadWith([oneWay])}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onBack={() => {}}
      onSendMessage={() => {}}
    />
  );

  expect(html).toContain("Orbit → Scout");
  expect(html).not.toContain("↔");
});

test("names the other direction when only this agent wrote", () => {
  const outbound: PeerExchangeView = {
    ...exchange,
    messages: [{ ...exchange.messages[0]!, author: "agent" }],
  };
  const html = renderToStaticMarkup(
    <ChatThread
      chat={threadWith([outbound])}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onBack={() => {}}
      onSendMessage={() => {}}
    />
  );

  expect(html).toContain("Scout → Orbit");
});

test("uses the singular for a one-message exchange", () => {
  const single: PeerExchangeView = {
    ...exchange,
    messages: [exchange.messages[0]!],
  };
  const html = renderToStaticMarkup(
    <ChatThread
      chat={threadWith([single])}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onBack={() => {}}
      onSendMessage={() => {}}
    />
  );

  expect(html).toContain("1 message");
  expect(html).not.toContain("1 messages");
});

test("falls back to the name on the signal when the peer cannot be resolved", () => {
  // An archived or deleted peer has no entry in the chat list; the exchange still
  // has to render, because it is what happened.
  const html = renderToStaticMarkup(
    <ChatThread
      chat={threadWith([exchange])}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onBack={() => {}}
      onSendMessage={() => {}}
      resolveAgent={() => undefined}
    />
  );

  expect(html).toContain("Scout ↔ Orbit");
});

test("the dialog shows both sides, attributed and in order", () => {
  const html = renderToStaticMarkup(
    <PeerExchangeDialog
      exchange={exchange}
      agent={{ name: "Scout", avatarUrl: null }}
      peer={{ name: "Orbit", avatarUrl: null }}
      onClose={() => {}}
    />
  );

  expect(html).toContain('role="dialog"');
  expect(html).toContain('aria-modal="true"');
  expect(html).toContain("Scout ↔ Orbit");
  expect(html).toContain("Hi Scout! I&#x27;m Orbit, your new teammate.");
  expect(html).toContain("Welcome aboard — I&#x27;ll send you the brief.");
  // Oldest first: the peer wrote in before the agent answered.
  expect(html.indexOf("Hi Scout!")).toBeLessThan(html.indexOf("Welcome aboard"));
  expect(html).toContain('aria-label="Close the conversation"');
});
