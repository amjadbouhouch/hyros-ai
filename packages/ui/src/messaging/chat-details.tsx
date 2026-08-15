import { AtSign, Briefcase, Paperclip, X } from "lucide-react";

import { ChatAvatar } from "./avatar.js";
import type { Chat, MessageAttachment } from "./types.js";

interface ChatDetailsProps {
  chat: Chat;
  /** Shown on small screens where the panel overlays the thread. */
  onClose?: () => void;
}

/** Right-hand panel with the contact's profile and shared files. */
export function ChatDetails({ chat, onClose }: ChatDetailsProps) {
  const sharedFiles: MessageAttachment[] = chat.messages.flatMap(
    (message) => message.attachments ?? []
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex h-16 shrink-0 items-center justify-between px-4">
        <h2 className="text-sm font-semibold">Details</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close details"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Profile */}
      <div className="flex flex-col items-center gap-1 px-4 py-6 text-center">
        <ChatAvatar
          name={chat.name}
          status={chat.status}
          className="size-20 text-lg"
        />
        <p className="mt-2 text-base font-semibold">{chat.name}</p>
        <p className="text-sm text-muted-foreground capitalize">{chat.status}</p>
      </div>

      {/* Info */}
      <div className="space-y-3 px-4 py-4 text-sm">
        <div className="flex items-center gap-3">
          <Briefcase className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{chat.role}</span>
        </div>
        <div className="flex items-center gap-3">
          <AtSign className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{chat.email}</span>
        </div>
      </div>

      {/* Shared files */}
      <div className="px-4 py-4">
        <h3 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Shared files ({sharedFiles.length})
        </h3>
        {sharedFiles.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No files shared yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {sharedFiles.map((file) => (
              <li
                key={file.file}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Paperclip className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-sm">{file.file}</p>
                  <p className="text-xs text-muted-foreground">
                    {file.fileSize}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
