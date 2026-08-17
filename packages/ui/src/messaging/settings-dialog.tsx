import { useEffect } from "react";
import { LogOut, X } from "lucide-react";

import type { UserProfile } from "@hyros-ai/domain";
import { APP_SCALES, useAppScale, type AppScale } from "../lib/app-scale.js";
import { cn } from "../lib/cn.js";
import { ChatAvatar } from "./avatar.js";

const SCALE_LABELS: Record<AppScale, string> = {
  sm: "Small",
  base: "Default",
  lg: "Large",
};

interface SettingsDialogProps {
  user: UserProfile;
  onClose: () => void;
  /** Omitted when the host app has no session to end (e.g. web preview). */
  onSignOut?: () => void;
}

/**
 * Account and appearance settings. Modal because it is a rare, focused task —
 * the sidebar stays a pure conversation surface.
 */
export function SettingsDialog({ user, onClose, onSignOut }: SettingsDialogProps) {
  const [appScale, setAppScale] = useAppScale();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="relative w-full max-w-md rounded-2xl border border-border bg-background p-5 text-foreground shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="settings-title" className="text-base font-semibold">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            title="Close settings"
            aria-label="Close settings"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <X className="size-4" />
          </button>
        </div>

        <section className="mt-5">
          <h3 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Account
          </h3>
          <div className="mt-2 flex items-center gap-3">
            <ChatAvatar name={user.name} className="size-10 text-xs" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {user.email}
              </p>
            </div>
          </div>
        </section>

        <section className="mt-5">
          <h3 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Appearance
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Interface size for the whole app.
          </p>
          <div
            role="group"
            aria-label="Interface size"
            className="mt-2 flex gap-1 rounded-lg bg-muted p-1"
          >
            {APP_SCALES.map((scale) => (
              <button
                key={scale}
                type="button"
                onClick={() => setAppScale(scale)}
                aria-pressed={appScale === scale}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  appScale === scale
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {SCALE_LABELS[scale]}
              </button>
            ))}
          </div>
        </section>

        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
