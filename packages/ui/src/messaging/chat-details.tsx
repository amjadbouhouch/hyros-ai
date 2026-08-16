import { useEffect, useState } from "react";
import { Archive, CalendarClock, RefreshCw, X } from "lucide-react";

import type { AgentScheduleSummary } from "@hyros-ai/domain";

import { ChatAvatar } from "./avatar.js";
import type { Chat } from "./types.js";

interface ChatDetailsProps {
  chat: Chat;
  /** Shown on small screens where the panel overlays the thread. */
  onClose?: () => void;
  /** Soft-archive this agent and retain its profile/history. */
  onArchive?: () => Promise<void>;
  /** Read-only schedule loader supplied by the host application. */
  onLoadSchedules?: (chatId: string) => Promise<AgentScheduleSummary[]>;
}

function readableCadence(cron: string): string {
  if (cron === "@hourly" || cron === "0 * * * *") return "Every hour";
  if (cron === "@daily" || cron === "0 0 * * *") return "Every day at 00:00";
  if (cron === "@weekly" || cron === "0 0 * * 0") return "Every Sunday at 00:00";
  const everyMinutes = cron.match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyMinutes) return `Every ${everyMinutes[1]} minutes`;
  const daily = cron.match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (daily) return `Every day at ${daily[2]!.padStart(2, "0")}:${daily[1]!.padStart(2, "0")}`;
  const weekdays = cron.match(/^(\d{1,2}) (\d{1,2}) \* \* 1-5$/);
  if (weekdays) return `Weekdays at ${weekdays[2]!.padStart(2, "0")}:${weekdays[1]!.padStart(2, "0")}`;
  return cron;
}

function nextRunLabel(value: string | null): string {
  if (!value) return "Next run pending";
  return `Next ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))}`;
}

/** Right-hand panel: the agent's profile. */
export function ChatDetails({ chat, onClose, onArchive, onLoadSchedules }: ChatDetailsProps) {
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<AgentScheduleSummary[]>([]);
  const [loadingSchedules, setLoadingSchedules] = useState(Boolean(onLoadSchedules));
  const [schedulesError, setSchedulesError] = useState<string | null>(null);

  async function loadSchedules() {
    if (!onLoadSchedules) return;
    setLoadingSchedules(true);
    setSchedulesError(null);
    try {
      setSchedules(await onLoadSchedules(chat.id));
    } catch {
      setSchedulesError("Could not load schedules.");
    } finally {
      setLoadingSchedules(false);
    }
  }

  useEffect(() => {
    void loadSchedules();
  }, [chat.id, chat.running, onLoadSchedules]);

  async function handleArchive() {
    if (!onArchive || archiving) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      await onArchive();
    } catch (error) {
      setArchiveError(
        error instanceof Error ? error.message : "Could not archive this agent."
      );
      setArchiving(false);
    }
  }

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
          url={chat.avatarUrl}
          className="size-20 text-lg"
        />
        <p className="mt-2 text-base font-semibold">{chat.name}</p>
        <p className="text-sm text-muted-foreground">
          {chat.running ? "working…" : (chat.description ?? "New agent")}
        </p>
      </div>

      {onLoadSchedules && (
        <section className="border-t border-border px-4 py-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarClock className="size-4 text-muted-foreground" />
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Schedules
              </h3>
            </div>
            {!loadingSchedules && schedules.length > 0 && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {schedules.length}
              </span>
            )}
          </div>

          {loadingSchedules ? (
            <div className="space-y-3 py-1" aria-label="Loading schedules">
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ) : schedulesError ? (
            <div className="flex items-center justify-between gap-3 py-2">
              <p role="alert" className="text-xs text-muted-foreground">{schedulesError}</p>
              <button
                type="button"
                onClick={() => void loadSchedules()}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Retry"
              >
                <RefreshCw className="size-3.5" />
              </button>
            </div>
          ) : schedules.length === 0 ? (
            <p className="py-2 text-xs leading-relaxed text-muted-foreground">
              No schedules yet. Ask your agent to schedule recurring work.
            </p>
          ) : (
            <div className="divide-y divide-border border-y border-border">
              {schedules.map((schedule) => (
                <div key={schedule.id} className="py-3" title={schedule.prompt}>
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <p className="truncate text-sm font-medium">{schedule.name}</p>
                    <span className="flex shrink-0 items-center gap-1.5 text-[11px] capitalize text-muted-foreground">
                      <span
                        className={schedule.status === "active" ? "size-1.5 rounded-full bg-emerald-500" : "size-1.5 rounded-full bg-muted-foreground/50"}
                      />
                      {schedule.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {readableCadence(schedule.cron)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/75">
                    {[schedule.timezone, nextRunLabel(schedule.nextFireAt)].filter(Boolean).join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {onArchive && (
        <div className="mt-auto border-t border-border p-4">
          {confirmingArchive ? (
            <div className="space-y-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Archive {chat.name}?</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  It will disappear from your agent list, but its profile and
                  conversation history will be kept. Its schedules will be
                  permanently deleted.
                </p>
              </div>
              {archiveError && (
                <p role="alert" className="text-xs text-destructive">
                  {archiveError}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={archiving}
                  onClick={() => void handleArchive()}
                  className="flex-1 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {archiving ? "Archiving…" : "Archive"}
                </button>
                <button
                  type="button"
                  disabled={archiving}
                  onClick={() => {
                    setConfirmingArchive(false);
                    setArchiveError(null);
                  }}
                  className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingArchive(true)}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <Archive className="size-4" />
              Archive agent
            </button>
          )}
        </div>
      )}
    </div>
  );
}
