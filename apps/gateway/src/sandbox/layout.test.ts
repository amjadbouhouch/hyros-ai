import { describe, expect, test } from "bun:test";

import { agentWorkdir, assertOwnWorkspacePaths, resolveWorkspacePath } from "./layout.js";

const AGENT = "agent-a";

describe("resolveWorkspacePath", () => {
    test("accepts every shape a model reaches for", () => {
        const expected = `${agentWorkdir(AGENT)}/notes.md`;
        expect(resolveWorkspacePath(AGENT, "notes.md")).toBe(expected);
        expect(resolveWorkspacePath(AGENT, "./notes.md")).toBe(expected);
        expect(resolveWorkspacePath(AGENT, "/notes.md")).toBe(expected);
        expect(resolveWorkspacePath(AGENT, `${agentWorkdir(AGENT)}/notes.md`)).toBe(expected);
    });
});

describe("assertOwnWorkspacePaths", () => {
    test("allows the agent's own paths and non-workspace paths", () => {
        for (const command of [
            "python analyze.py",
            `cat ${agentWorkdir(AGENT)}/notes.md`,
            "ls /tmp && /usr/bin/python3 --version",
            "pip install --user requests",
            "cat /workspace/.shared/skills/writing/SKILL.md",
        ]) {
            expect(assertOwnWorkspacePaths(command, AGENT)).toBeNull();
        }
    });

    test("refuses another agent's directory, however it is reached", () => {
        for (const command of [
            "cat /workspace/agent-b/secret.txt",
            "cp /workspace/agent-b/notes.md .",
            `dd of=/workspace/agent-b/planted.txt if=/dev/zero`,
            "cat /workspace/agent-a/../agent-b/secret.txt",
            "sh -c 'rm -rf /workspace/agent-b'",
            "tar czf - /workspace/agent-b > out.tgz",
        ]) {
            expect(assertOwnWorkspacePaths(command, AGENT)).toContain("another agent");
        }
    });

    test("refuses writes aimed at the workspace root", () => {
        expect(assertOwnWorkspacePaths("rm -rf /workspace/", AGENT)).toContain("another agent");
    });

    test("does not confuse a sibling whose name shares a prefix", () => {
        expect(assertOwnWorkspacePaths("cat /workspace/agent-ab/x", AGENT)).toContain(
            "another agent",
        );
    });
});
