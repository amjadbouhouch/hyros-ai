import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SettingsDialog } from "../src/messaging/settings-dialog.js";

const user = {
  id: "user-1",
  name: "Amjed",
  email: "amjed@example.com",
  avatarUrl: null,
};

test("exposes sign-out and the interface size control", () => {
  const html = renderToStaticMarkup(
    <SettingsDialog user={user} onClose={() => {}} onSignOut={() => {}} />
  );

  expect(html).toContain('role="dialog"');
  expect(html).toContain('aria-modal="true"');
  expect(html).toContain("Sign out");
  expect(html).toContain('aria-label="Interface size"');
  expect(html).toContain("Small");
  expect(html).toContain("Default");
  expect(html).toContain("Large");
  expect(html).toContain("amjed@example.com");
});

test("hides sign-out when the host app has no session to end", () => {
  const html = renderToStaticMarkup(
    <SettingsDialog user={user} onClose={() => {}} />
  );

  expect(html).not.toContain("Sign out");
  expect(html).toContain('aria-label="Interface size"');
});
