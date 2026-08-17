import { describe, expect, test } from "bun:test";

import { HyrosSandbox } from "./hyros-sandbox.js";
import { agentWorkdir } from "./layout.js";
import {
    SandboxServiceClient,
    SandboxServiceError,
    type FetchLike,
} from "./service-client.js";

const ORG = "org-1";
const AGENT = "agent-a";
const UID = 10_000;

interface Call {
    method: string;
    path: string;
    body: unknown;
}

/**
 * A service stub: records calls and answers from a queue of scripted responses,
 * so the whole client/provider path is exercised without a socket or Docker.
 */
function stubService(
    responses: Array<{ status?: number; body: unknown }>,
): { fetchImpl: FetchLike; calls: Call[] } {
    const calls: Call[] = [];
    const queue = [...responses];

    const fetchImpl: FetchLike = async (input, init) => {
        const url = new URL(input);
        calls.push({
            method: init?.method ?? "GET",
            path: url.pathname + url.search,
            body: init?.body ? JSON.parse(init.body) : undefined,
        });
        const next = queue.shift() ?? { body: {} };
        const status = next.status ?? 200;
        const payload = JSON.stringify(next.body);
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => JSON.parse(payload),
            text: async () => payload,
        };
    };

    return { fetchImpl, calls };
}

function sandboxWith(responses: Array<{ status?: number; body: unknown }>) {
    const { fetchImpl, calls } = stubService(responses);
    const client = new SandboxServiceClient({ url: "http://sandbox.test", token: "t" }, fetchImpl);
    const sandbox = new HyrosSandbox({
        organizationId: ORG,
        agentId: AGENT,
        uid: UID,
        client,
    });
    return { sandbox, calls };
}

const EXEC_OK = {
    body: {
        success: true,
        exitCode: 0,
        stdout: "hello\n",
        stderr: "",
        executionTimeMs: 12,
        timedOut: false,
        killed: false,
        command: "echo",
        args: ["hello"],
    },
};

describe("HyrosSandbox", () => {
    test("names the handle after both the organization and the agent", () => {
        const { sandbox } = sandboxWith([]);
        // Two agents share one container; a per-organization id would collide.
        expect(sandbox.id).toBe(`${ORG}:${AGENT}`);
        expect(sandbox.provider).toBe("hyros-sandbox-service");
    });

    test("starting provisions this agent into the organization's container", async () => {
        const { sandbox, calls } = sandboxWith([{ body: {} }, EXEC_OK]);

        const result = await sandbox.executeCommand("echo", ["hello"]);

        expect(result.stdout).toBe("hello\n");
        expect(calls[0]).toMatchObject({
            method: "POST",
            path: "/sandboxes",
            body: { organizationId: ORG, agents: [{ agentId: AGENT, uid: UID }] },
        });
        expect(calls[1]).toMatchObject({
            method: "POST",
            path: `/sandboxes/${ORG}/exec`,
            body: { agentId: AGENT, command: "echo", args: ["hello"] },
        });
    });

    test("provisions and retries once when the agent has no directory yet", async () => {
        const { sandbox, calls } = sandboxWith([
            { body: {} }, // ensureSandbox
            { status: 409, body: { error: "no workspace", code: "AGENT_NOT_PROVISIONED" } },
            { body: { success: true, agentId: AGENT, uid: UID } },
            EXEC_OK,
        ]);

        const result = await sandbox.executeCommand("echo", ["hello"]);

        expect(result.success).toBe(true);
        expect(calls.map((call) => call.path)).toEqual([
            "/sandboxes",
            `/sandboxes/${ORG}/exec`,
            `/sandboxes/${ORG}/agents/${AGENT}`,
            `/sandboxes/${ORG}/exec`,
        ]);
    });

    test("surfaces other service failures instead of retrying them", async () => {
        const { sandbox, calls } = sandboxWith([
            { body: {} },
            { status: 503, body: { error: "docker down", code: "DOCKER_UNAVAILABLE" } },
        ]);

        await expect(sandbox.executeCommand("echo")).rejects.toThrow(SandboxServiceError);
        expect(calls).toHaveLength(2);
    });

    test("refuses a command aimed at another agent without calling the service", async () => {
        const { sandbox, calls } = sandboxWith([{ body: {} }]);

        const result = await sandbox.executeCommand("cat /workspace/agent-b/secret.txt");

        expect(result.success).toBe(false);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("another agent");
        // Nothing left the gateway at all: the guardrail runs before the sandbox
        // is even provisioned, so a refused command costs no round trip.
        expect(calls).toEqual([]);
    });

    test("resolves relative paths into the agent's own directory", async () => {
        const { sandbox, calls } = sandboxWith([
            { body: {} },
            { body: { success: true, path: "x", bytesWritten: 3 } },
        ]);

        await sandbox.writeFile("notes/today.md", "abc");

        expect(calls[1]?.body).toMatchObject({
            agentId: AGENT,
            path: `${agentWorkdir(AGENT)}/notes/today.md`,
            content: "abc",
            encoding: "utf-8",
        });
    });

    test("destroy leaves the shared container alone", async () => {
        const { sandbox, calls } = sandboxWith([{ body: {} }, EXEC_OK]);
        await sandbox.executeCommand("true");
        const before = calls.length;

        await sandbox.destroy();

        // Nothing is sent: the container belongs to the organization, and the
        // service keys DELETE by organization id, so calling through here would
        // end every sibling agent's session.
        expect(calls.length).toBe(before);
        expect(sandbox.status).toBe("stopped");
    });

    test("instructions tell the agent where it may write", () => {
        const { sandbox } = sandboxWith([]);
        const instructions = sandbox.getInstructions();
        expect(instructions).toContain(agentWorkdir(AGENT));
        expect(instructions).toContain("/workspace/.shared");
        expect(instructions).toContain("off limits");
    });
});
