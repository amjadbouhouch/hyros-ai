import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkingIndicator } from "../src/messaging/working-indicator.js";
import { ChatThread } from "../src/messaging/chat-thread.js";
import type { Chat } from "../src/messaging/types.js";

test("renders the running agent avatar and accessible working status", () => {
  const html = renderToStaticMarkup(
    <WorkingIndicator
      name="Atlas"
      avatarUrl="data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E"
    />
  );

  expect(html).toContain('role="status"');
  expect(html).toContain('aria-label="Atlas is working"');
  expect(html).toContain("Atlas is working…");
  expect(html).toContain("data:image/svg+xml");
  expect(html).toContain("calc(50% - var(--spread))");
  expect(html).toContain("background-size:250% 100%, 100% 100%");
});

test("places the working indicator in the message stream, not the composer dock", () => {
  const chat: Chat = {
    id: "agent-1",
    name: "Atlas",
    description: "A research agent",
    avatarUrl: null,
    running: true,
    pendingQuestion: null,
    lastMessage: null,
    messages: [
      {
        id: "message-1",
        role: "assistant",
        text: "I am checking that now.",
        createdAt: "2026-08-16T12:00:00.000Z",
      },
    ],
  };

  const html = renderToStaticMarkup(
    <ChatThread
      chat={chat}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onBack={() => {}}
      onSendMessage={() => {}}
    />
  );

  const messageStream = html.indexOf("overflow-y-auto");
  const workingStatus = html.indexOf('role="status"');
  const composerDock = html.indexOf("<form");

  expect(messageStream).toBeGreaterThan(-1);
  expect(workingStatus).toBeGreaterThan(messageStream);
  expect(composerDock).toBeGreaterThan(workingStatus);
});

test("keeps the composer floating over the thread with a translucent blur", () => {
  const chat: Chat = {
    id: "agent-1",
    name: "Atlas",
    description: "A research agent",
    avatarUrl: null,
    running: false,
    pendingQuestion: null,
    lastMessage: null,
    messages: [],
  };

  const html = renderToStaticMarkup(
    <ChatThread
      chat={chat}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onBack={() => {}}
      onSendMessage={() => {}}
    />
  );

  expect(html).toContain("pointer-events-none absolute inset-x-0 bottom-0");
  expect(html).toContain("bg-background/85");
  expect(html).toContain("backdrop-blur");
  expect(html).toContain("pb-28");
  expect(html).toContain("<textarea");
  expect(html).toContain('aria-label="Add attachments (coming soon)"');
  expect(html).toContain('aria-label="Record audio (coming soon)"');
});

test("keeps the thread header focused on the agent identity", () => {
  const chat: Chat = {
    id: "agent-1",
    name: "Atlas",
    description: "This description belongs in the details panel only",
    avatarUrl: null,
    running: false,
    pendingQuestion: null,
    lastMessage: null,
    messages: [],
  };

  const html = renderToStaticMarkup(
    <ChatThread
      chat={chat}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onBack={() => {}}
      onSendMessage={() => {}}
    />
  );

  expect(html).toContain("Atlas");
  expect(html).not.toContain("This description belongs in the details panel only");
});
