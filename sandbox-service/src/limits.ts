/**
 * Concurrency caps for container-touching work.
 *
 * One bearer token and one shared container per organization mean a single
 * runaway loop would otherwise starve the host for every other tenant. Requests
 * wait for a slot; once the queue is full they are rejected rather than piling
 * up behind work that is already too slow.
 */

const PER_SANDBOX_LIMIT = Number(process.env.SANDBOX_MAX_CONCURRENT_PER_SANDBOX) || 3;
const GLOBAL_LIMIT = Number(process.env.SANDBOX_MAX_CONCURRENT) || 24;
const MAX_QUEUED = Number(process.env.SANDBOX_MAX_QUEUED) || 64;

export class SandboxBusyError extends Error {
    readonly code = "SANDBOX_BUSY";

    constructor(scope: string) {
        super(`Too many concurrent sandbox requests (${scope}). Retry shortly.`);
        this.name = "SandboxBusyError";
    }
}

/**
 * Counting semaphore with a bounded wait queue. A released slot is handed
 * straight to the next waiter, so `_active` never exceeds `limit`.
 */
class Semaphore {
    private _active = 0;
    private readonly _waiting: Array<() => void> = [];

    constructor(
        private readonly limit: number,
        private readonly maxWaiting: number,
        private readonly scope: string,
    ) {}

    async acquire(): Promise<void> {
        if (this._active < this.limit) {
            this._active++;
            return;
        }
        if (this._waiting.length >= this.maxWaiting) {
            throw new SandboxBusyError(this.scope);
        }
        await new Promise<void>((resolve) => this._waiting.push(resolve));
    }

    release(): void {
        const next = this._waiting.shift();
        if (next) {
            next(); // slot transfers directly — _active stays put
        } else {
            this._active--;
        }
    }

    get isIdle(): boolean {
        return this._active === 0 && this._waiting.length === 0;
    }
}

const globalSlots = new Semaphore(GLOBAL_LIMIT, MAX_QUEUED, "global");
const sandboxSlots = new Map<string, Semaphore>();

/**
 * Runs `task` while holding one global slot and one slot for this sandbox.
 *
 * @throws {SandboxBusyError} when either queue is full.
 */
export async function withSandboxSlot<T>(id: string, task: () => Promise<T>): Promise<T> {
    let slots = sandboxSlots.get(id);
    if (!slots) {
        slots = new Semaphore(PER_SANDBOX_LIMIT, MAX_QUEUED, `sandbox ${id}`);
        sandboxSlots.set(id, slots);
    }

    await globalSlots.acquire();
    try {
        await slots.acquire();
        try {
            return await task();
        } finally {
            slots.release();
            // Keep the map bounded — an idle sandbox needs no semaphore.
            if (slots.isIdle) sandboxSlots.delete(id);
        }
    } finally {
        globalSlots.release();
    }
}

export const CONCURRENCY_LIMITS = {
    perSandbox: PER_SANDBOX_LIMIT,
    global: GLOBAL_LIMIT,
    maxQueued: MAX_QUEUED,
};
