import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatList } from "../src/messaging/chat-list.js";

const user = {
  id: "user-1",
  name: "Amjed",
  email: "amjed@example.com",
  avatarUrl: null,
};

const chats = [
  {
    id: "agent-1",
    name: "Atlas",
    description: null,
    avatarUrl: null,
    running: false,
    pendingQuestion: null,
    lastMessage: null,
    messages: [],
  },
];

test("renders the collapsed sidebar as an avatar rail that stays readable", () => {
  const html = renderToStaticMarkup(
    <ChatList
      chats={chats}
      activeChatId="agent-1"
      onSelectChat={() => {}}
      search=""
      onSearchChange={() => {}}
      user={user}
      collapsed
      onToggleCollapsed={() => {}}
      onOpenSettings={() => {}}
    />
  );

  expect(html).toContain('aria-label="Expand sidebar"');
  expect(html).toContain("md:justify-center md:px-0");
  expect(html).toContain("md:hidden");
  // The rail hides the agent name visually; assistive tech still needs it.
  expect(html).toContain('class="sr-only hidden md:inline">Atlas');
  expect(html).toContain('title="Atlas"');
});

test("offers settings as the entry point for account actions", () => {
  const html = renderToStaticMarkup(
    <ChatList
      chats={chats}
      activeChatId="agent-1"
      onSelectChat={() => {}}
      search=""
      onSearchChange={() => {}}
      user={user}
      collapsed={false}
      onToggleCollapsed={() => {}}
      onOpenSettings={() => {}}
    />
  );

  expect(html).toContain('aria-label="Settings"');
  // Sign-out lives in the settings dialog, not in the sidebar itself.
  expect(html).not.toContain("Sign out");
});
