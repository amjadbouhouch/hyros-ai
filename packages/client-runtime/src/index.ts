/**
 * @hyros-ai/client-runtime — shared non-visual client logic.
 *
 * Everything a client needs besides UI: auth session lifecycle today;
 * connection/network supervision and shared state later (TASK-012 plan).
 * Import from the root; internals stay mobile-safe (no DOM/Node/React).
 */

export {
    createSessionManager,
    type RestoreResult,
    type SessionManager,
    type SessionManagerOptions,
    type SessionStore,
    type StoredSession,
} from "./session.js";