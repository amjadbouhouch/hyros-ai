export { Button } from "./Button.js";
export type { ButtonProps } from "./Button.js";
export { Shimmer, type ShimmerProps } from "./ai-elements/shimmer.js";

export { cn } from "./lib/cn.js";
export { formatRelativeTime } from "./lib/relative-time.js";
export {
  APP_SCALES,
  applyPersistedAppScale,
  getAppScale,
  setAppScale,
  useAppScale,
  type AppScale,
} from "./lib/app-scale.js";

export {
  Bubble,
  BubbleContent,
  BubbleGroup,
  BubbleReactions,
} from "./ui/bubble.js";
export {
  MessageBubble,
  type MessageBubbleProps,
  type MessageTone,
} from "./messaging/message-bubble.js";

export { MessagingApp } from "./messaging/messaging-app.js";
export { SettingsDialog } from "./messaging/settings-dialog.js";
export { PeerExchangeRow, type AgentIdentity } from "./messaging/peer-exchange-row.js";
export { PeerExchangeDialog } from "./messaging/peer-exchange-dialog.js";
export {
  type Chat,
  type ChatMessage,
  type ChatThreadItem,
  type PeerExchangeView,
  type PeerMessageView,
} from "./messaging/types.js";
