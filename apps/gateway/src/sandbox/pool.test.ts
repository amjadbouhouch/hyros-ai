import { describe, expect, test } from "bun:test";

import { HyrosSandbox } from "./hyros-sandbox.js";
import { SandboxPool, sandboxCacheKey } from "./pool.js";
import { SandboxServiceClient, type FetchLike } from "./service-client.js";

const ORG = "org-1";

/** Records calls; every response is an empty 200. */
function stubClient(): { client: SandboxServiceClient; calls: string[] } {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (input, init) => {
        calls.push(`${init?.method ?? "GET"} ${new URL(input).pathname}`);
        return {
            ok: true,
            status: 200,
            json: async () => ({}),
            text: async () => "{}",
        };
    };
    return {
        client: new SandboxServiceClient({ url: "http://sandbox.test" }, fetchImpl),
        calls,
    };
}

function poolWith(): { pool: SandboxPool; calls: string[] } {
    const { client, calls } = stubClient();
    return { pool: new SandboxPool({ service: { url: "http://sandbox.test" } }, client), calls };
}

describe("SandboxPool", () => {
    test("memoizes one handle per agent", () => {
        const { pool } = poolWith();

        const first = pool.resolveSandbox({ organizationId: ORG, agentId: "a", uid: 10_000 });
        const again = pool.resolveSandbox({ organizationId: ORG, agentId: "a", uid: 10_000 });
        const sibling = pool.resolveSandbox({ organizationId: ORG, agentId: "b", uid: 10_001 });

        expect(again).toBe(first);
        expect(sibling).not.toBe(first);
        expect(first).toBeInstanceOf(HyrosSandbox);
    });

    test("resolving touches nothing on the sandbox host", () => {
        // Building an agent runtime must not depend on the sandbox service being
        // up: a chat has to work even when that host is down.
        const { pool, calls } = poolWith();

        pool.resolveSandbox({ organizationId: ORG, agentId: "a", uid: 10_000 });

        expect(calls).toEqual([]);
    });

    test("forgetting an agent keeps the organization's other handles", () => {
        const { pool } = poolWith();
        const a = pool.resolveSandbox({ organizationId: ORG, agentId: "a", uid: 10_000 });
        const b = pool.resolveSandbox({ organizationId: ORG, agentId: "b", uid: 10_001 });

        pool.forgetAgent({ organizationId: ORG, agentId: "a" });

        expect(pool.resolveSandbox({ organizationId: ORG, agentId: "a", uid: 10_000 })).not.toBe(a);
        expect(pool.resolveSandbox({ organizationId: ORG, agentId: "b", uid: 10_001 })).toBe(b);
    });

    test("forgetting an organization drops only its handles", () => {
        const { pool } = poolWith();
        const mine = pool.resolveSandbox({ organizationId: ORG, agentId: "a", uid: 10_000 });
        const other = pool.resolveSandbox({ organizationId: "org-2", agentId: "a", uid: 10_000 });

        pool.forgetOrganization(ORG);

        expect(pool.resolveSandbox({ organizationId: ORG, agentId: "a", uid: 10_000 })).not.toBe(mine);
        expect(pool.resolveSandbox({ organizationId: "org-2", agentId: "a", uid: 10_000 })).toBe(other);
    });

    test("destroying an organization removes its container", async () => {
        const { client, calls } = stubClient();
        const pool = new SandboxPool({ service: { url: "http://sandbox.test" } }, client);

        await pool.destroyOrganization(ORG, { purgeVolume: true });

        expect(calls).toEqual([`DELETE /sandboxes/${ORG}`]);
    });

    test("cache key names the agent, not just the tenant", () => {
        // Two agents share one container but not one working directory.
        expect(sandboxCacheKey({ organizationId: ORG, agentId: "a" })).toBe(`${ORG}:a`);
        expect(sandboxCacheKey({ organizationId: ORG, agentId: "b" })).not.toBe(
            sandboxCacheKey({ organizationId: ORG, agentId: "a" }),
        );
    });
});
