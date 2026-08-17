/**
 * The one error type this service throws.
 *
 * Every failure carries a stable `code` because the gateway maps codes, not
 * message text: a reworded message must never change client behaviour.
 */
export class SandboxError extends Error {
    readonly code: string;

    constructor(message: string, code: string) {
        super(message);
        this.name = "SandboxError";
        this.code = code;
    }
}
