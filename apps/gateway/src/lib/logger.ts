/**
 * Tiny dependency-free logger for the gateway.
 *
 * Levels: debug < info < warn < error (+ silent). Controlled with the
 * LOG_LEVEL env var; defaults to `info`, and to `silent` under `bun test`
 * (NODE_ENV=test) so test output stays clean. Honors NO_COLOR.
 *
 * Usage:
 *   import { createLogger } from "../lib/logger.js";
 *   const log = createLogger("oauth");
 *   log.info("code stored", { pollId, pending: 2 });
 *   // 12:34:56.789 INFO  [oauth] code stored pollId=… pending=2
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_VALUE: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const LEVEL_COLOR: Record<LogLevel, string> = {
    debug: "\x1b[90m", // gray
    info: "\x1b[36m", // cyan
    warn: "\x1b[33m", // yellow
    error: "\x1b[31m", // red
};
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

const useColor = !process.env.NO_COLOR && process.env.FORCE_COLOR !== "0";

/** Threshold is re-read per call so LOG_LEVEL can change between processes/tests. */
function threshold(): number {
    const raw = (process.env.LOG_LEVEL ?? "").trim().toLowerCase();
    if (raw === "silent") return Number.POSITIVE_INFINITY;
    if (raw in LEVEL_VALUE) return LEVEL_VALUE[raw as LogLevel];
    // Keep `bun test` output clean unless LOG_LEVEL is set explicitly.
    if (process.env.NODE_ENV === "test") return Number.POSITIVE_INFINITY;
    return LEVEL_VALUE.info;
}

/** Local HH:MM:SS.mmm — easiest to scan while watching a live OAuth flow. */
function timestamp(): string {
    const d = new Date();
    const p = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function formatData(data?: Record<string, unknown>): string {
    if (!data) return "";
    return Object.entries(data)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ");
}

function emit(
    level: LogLevel,
    scope: string | null,
    msg: string,
    data?: Record<string, unknown>,
): void {
    if (LEVEL_VALUE[level] < threshold()) return;
    const lvl = level.toUpperCase().padEnd(5);
    const ts = useColor ? `${DIM}${timestamp()}${RESET}` : timestamp();
    const coloredLvl = useColor ? `${LEVEL_COLOR[level]}${lvl}${RESET}` : lvl;
    const scopePart = scope ? `[${scope}] ` : "";
    const dataPart = formatData(data);
    const line = `${ts} ${coloredLvl} ${scopePart}${msg}${dataPart ? ` ${dataPart}` : ""}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
}

export interface Logger {
    debug(msg: string, data?: Record<string, unknown>): void;
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
    child(scope: string): Logger;
}

export function createLogger(scope?: string): Logger {
    return {
        debug: (msg, data) => emit("debug", scope ?? null, msg, data),
        info: (msg, data) => emit("info", scope ?? null, msg, data),
        warn: (msg, data) => emit("warn", scope ?? null, msg, data),
        error: (msg, data) => emit("error", scope ?? null, msg, data),
        child: (childScope) =>
            createLogger(scope ? `${scope}:${childScope}` : childScope),
    };
}

/** Root gateway logger — prefer `createLogger("scope")` inside modules. */
export const log = createLogger();
