import type { UserProfile } from "@hyros-ai/domain";
import { MessagingApp } from "@hyros-ai/ui";

/**
 * Mock signed-in user for the messaging preview — replaced by the real session
 * (client-runtime + platform seam) once web auth lands.
 */
const MOCK_USER: UserProfile = {
  id: "demo-user",
  email: "ada.lovelace@hyros.ai",
  name: "Ada Lovelace",
  avatarUrl: null,
};

export function App() {
  return <MessagingApp user={MOCK_USER} />;
}
