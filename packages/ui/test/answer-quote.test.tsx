import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatThread } from "../src/messaging/chat-thread.js";
import type { Chat } from "../src/messaging/types.js";

function chatWith(messages: Chat["messages"]): Chat {
  return {
    id: "agent-1",
    name: "Spark",
    description: "Writing assistant",
    avatarUrl: null,
    running: false,
    pendingQuestion: null,
    lastMessage: null,
    messages,
  };
}

test("shows an ask_user answer as a reply quoting the agent's question", () => {
  const html = renderToStaticMarkup(
    <ChatThread
      chat={chatWith([
        {
          kind: "message",
          id: "answer-1",
          role: "user",
          text: "Writing & content",
          createdAt: "2026-08-16T00:00:00.000Z",
          replyTo: "What should I help you with?",
        },
      ])}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onBack={() => {}}
      onSendMessage={() => {}}
    />
  );

  expect(html).toContain("What should I help you with?");
  // Quoted question is attributed to the agent, above the answer text.
  expect(html.indexOf("Spark</span>")).toBeLessThan(
    html.indexOf("What should I help you with?")
  );
  expect(html.indexOf("What should I help you with?")).toBeLessThan(
    html.indexOf("Writing &amp; content")
  );
});

test("leaves an ordinary message without a quote", () => {
  const html = renderToStaticMarkup(
    <ChatThread
      chat={chatWith([
        {
          kind: "message",
          id: "msg-1",
          role: "user",
          text: "Hello",
          createdAt: "2026-08-16T00:00:00.000Z",
        },
      ])}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onBack={() => {}}
      onSendMessage={() => {}}
    />
  );

  expect(html).not.toContain("lucide-reply");
});
