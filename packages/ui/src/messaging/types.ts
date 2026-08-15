/** Presence shown next to a user in the chat list and thread header. */
export type ChatStatus = "online" | "busy" | "away" | "offline";

/** A file shared inside a message. */
export interface MessageAttachment {
  file: string;
  fileSize: string;
}

export interface ChatMessage {
  id: number;
  /** `senderId === CURRENT_USER_ID` means the signed-in user authored it. */
  senderId: number;
  text: string;
  createdAt: Date;
  attachments?: MessageAttachment[];
}

/** A user-to-user conversation. */
export interface Chat {
  id: number;
  name: string;
  email: string;
  role: string;
  status: ChatStatus;
  messages: ChatMessage[];
}

/** senderId used for the signed-in user in the mock data. */
export const CURRENT_USER_ID = 0;
