import { describe, expect, test } from "bun:test";

import {
    agentTmpDir,
    agentWorkdir,
    containerName,
    isValidAgentId,
    isValidOrganizationId,
    isValidUid,
    networkName,
    resolveAgentPath,
    UID_BASE,
    UID_POOL_SIZE,
    volumeName,
} from "./layout.js";

const AGENT = "agent-a";

describe("identifier validation", () => {
    test("accepts uuids and rejects anything shell-unsafe", () => {
        expect(isValidAgentId("2f9c1e14-1a3b-4c55-9a0e-6f1d2b3c4d5e")).toBe(true);
        expect(isValidOrganizationId("org_123.4-5")).toBe(true);

        for (const hostile of [
            "",
            ".hidden",
            "-leading-dash",
            "has space",
            "has/slash",
            "has$dollar",
            'has"quote',
            "has;semicolon",
            "..",
            "a".repeat(129),
        ]) {
            expect(isValidAgentId(hostile)).toBe(false);
        }
    });

    test("accepts only uids that have a baked OS user", () => {
        expect(isValidUid(UID_BASE)).toBe(true);
        expect(isValidUid(UID_BASE + UID_POOL_SIZE - 1)).toBe(true);
        expect(isValidUid(UID_BASE + UID_POOL_SIZE)).toBe(false);
        expect(isValidUid(UID_BASE - 1)).toBe(false);
        expect(isValidUid(0)).toBe(false);
        expect(isValidUid(1.5)).toBe(false);
    });
});

describe("docker object names", () => {
    test("derive from the organization id", () => {
        expect(containerName("org-1")).toBe("hyros-sandbox-org-1");
        expect(volumeName("org-1")).toBe("hyros-workspace-org-1");
        expect(networkName("org-1")).toBe("hyros-net-org-1");
    });

    test("give each organization its own network", () => {
        // Egress for everyone, but no two tenants on the same bridge.
        expect(networkName("org-1")).not.toBe(networkName("org-2"));
    });
});

describe("path jail", () => {
    test("keeps relative paths inside the agent's own directory", () => {
        expect(resolveAgentPath(AGENT, "notes.md", "write")).toBe(
            `${agentWorkdir(AGENT)}/notes.md`,
        );
        expect(resolveAgentPath(AGENT, "./sub/dir/file", "write")).toBe(
            `${agentWorkdir(AGENT)}/sub/dir/file`,
        );
        expect(resolveAgentPath(AGENT, agentTmpDir(AGENT), "write")).toBe(
            agentTmpDir(AGENT),
        );
    });

    test("rejects traversal and sibling agents", () => {
        expect(resolveAgentPath(AGENT, "../agent-b/secret", "read")).toBeNull();
        expect(resolveAgentPath(AGENT, "/workspace/agent-b/secret", "read")).toBeNull();
        expect(resolveAgentPath(AGENT, "sub/../../agent-b/x", "write")).toBeNull();
        expect(resolveAgentPath(AGENT, "/etc/passwd", "read")).toBeNull();
        // The workspace root itself belongs to no agent.
        expect(resolveAgentPath(AGENT, "/workspace", "read")).toBeNull();
    });

    test("allows reads from the shared directory but never writes", () => {
        expect(resolveAgentPath(AGENT, "/workspace/.shared/skills/x.md", "read")).toBe(
            "/workspace/.shared/skills/x.md",
        );
        expect(resolveAgentPath(AGENT, "/workspace/.shared/skills/x.md", "write")).toBeNull();
    });

    test("does not confuse a sibling whose name shares a prefix", () => {
        expect(resolveAgentPath("agent-a", "/workspace/agent-ab/file", "read")).toBeNull();
    });
});
