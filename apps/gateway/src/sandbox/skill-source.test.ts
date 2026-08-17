import { describe, expect, test } from "bun:test";

import { skillRoots, SHARED_SKILLS_DIR, agentSkillsDir } from "./layout.js";
import type { HyrosSandbox } from "./hyros-sandbox.js";
import { SandboxSkillSource } from "./skill-source.js";
import type { ListTreeResultDto, ReadFileResultDto, TreeEntryDto } from "./service-client.js";

const AGENT = "agent-a";
const SHARED = SHARED_SKILLS_DIR;
const OWN = agentSkillsDir(AGENT);
const MTIME = 1_787_002_574;

function entry(path: string, type: "file" | "directory", extra: Partial<TreeEntryDto> = {}) {
    return { path, type, size: type === "directory" ? 4096 : 128, modifiedAt: MTIME, ...extra };
}

const TREE: TreeEntryDto[] = [
    entry(SHARED, "directory"),
    entry(`${SHARED}/brand-voice`, "directory"),
    entry(`${SHARED}/brand-voice/SKILL.md`, "file"),
    entry(`${SHARED}/brand-voice/references`, "directory"),
    entry(`${SHARED}/brand-voice/references/tone.md`, "file"),
    entry(OWN, "directory"),
    entry(`${OWN}/invoice-parse`, "directory"),
    entry(`${OWN}/invoice-parse/SKILL.md`, "file"),
];

/**
 * Only the two methods the source reaches for. The real handle carries container
 * provisioning and retry, none of which this behaviour depends on.
 */
interface FakeSandbox {
    sandbox: HyrosSandbox;
    calls: { listTree: number; readFile: string[] };
    /** Replaces what the next listing returns. */
    setTree(entries: TreeEntryDto[], truncated?: boolean): void;
    /** Stands in for the agent writing something — as the real handle counts it. */
    mutate(): void;
    failListing(message: string): void;
}

function fakeSandbox(entries: TreeEntryDto[] = TREE): FakeSandbox {
    const calls = { listTree: 0, readFile: [] as string[] };
    let tree: TreeEntryDto[] = entries;
    let truncated = false;
    let failure: string | null = null;
    let mutations = 0;

    const sandbox = {
        agentId: AGENT,
        organizationId: "org-1",
        get mutations() {
            return mutations;
        },
        async listTree(): Promise<ListTreeResultDto> {
            calls.listTree += 1;
            if (failure) throw new Error(failure);
            return { entries: tree, truncated };
        },
        async readFile(path: string): Promise<ReadFileResultDto> {
            calls.readFile.push(path);
            const found = tree.find((item) => item.path === path && item.type === "file");
            return found
                ? {
                      success: true,
                      path,
                      content: Buffer.from(`body of ${path}`).toString("base64"),
                      bytesRead: 1,
                  }
                : { success: false, path, content: "", bytesRead: 0, error: "No such file" };
        },
    } as unknown as HyrosSandbox;

    return {
        sandbox,
        calls,
        setTree(next, isTruncated = false) {
            tree = next;
            truncated = isTruncated;
        },
        mutate() {
            mutations += 1;
        },
        failListing(message) {
            failure = message;
        },
    };
}

function build(fake: FakeSandbox, now: () => number = () => 0) {
    return new SandboxSkillSource({ sandbox: fake.sandbox, roots: skillRoots(AGENT), now });
}

describe("skill roots", () => {
    test("are absolute, so `.shared` is not resolved inside the agent's directory", () => {
        expect(skillRoots(AGENT)).toEqual([
            "/workspace/.shared/skills",
            `/workspace/${AGENT}/skills`,
        ]);
    });
});

describe("SandboxSkillSource", () => {
    test("answers exists from the listing, for both roots", async () => {
        const source = build(fakeSandbox());

        expect(await source.exists(`${SHARED}/brand-voice/SKILL.md`)).toBe(true);
        expect(await source.exists(`${OWN}/invoice-parse/SKILL.md`)).toBe(true);
        expect(await source.exists(`${SHARED}/does-not-exist/SKILL.md`)).toBe(false);
    });

    test("stats a file with the container's mtime, rounded to the end of its second", async () => {
        const stat = await build(fakeSandbox()).stat(`${SHARED}/brand-voice/SKILL.md`);

        expect(stat).toMatchObject({ name: "SKILL.md", type: "file", size: 128 });
        // Mastra compares this against a millisecond `Date.now()` taken at
        // discovery. `stat -c %Y` reports whole seconds, so truncating would make
        // a skill written at .900 lose to a discovery at .100 — and the directory
        // mtime never moves again, so it would stay invisible for good. Rounding
        // up costs a redundant re-scan; rounding down costs the skill.
        expect(stat.modifiedAt.getTime()).toBe(MTIME * 1000 + 999);
    });

    test("lists a directory's immediate children only", async () => {
        const names = (await build(fakeSandbox()).readdir(`${SHARED}/brand-voice`))
            .map((child) => child.name)
            .sort();

        expect(names).toEqual(["SKILL.md", "references"]);
    });

    test("distinguishes an empty directory from a missing one", async () => {
        const source = build(fakeSandbox([entry(SHARED, "directory")]));

        expect(await source.readdir(SHARED)).toEqual([]);
        await expect(source.readdir(`${SHARED}/nope`)).rejects.toThrow("ENOENT");
    });

    test("reads a file's bytes through the sandbox", async () => {
        const fake = fakeSandbox();
        const content = await build(fake).readFile(`${SHARED}/brand-voice/SKILL.md`);

        expect(content.toString()).toBe(`body of ${SHARED}/brand-voice/SKILL.md`);
        expect(fake.calls.readFile).toEqual([`${SHARED}/brand-voice/SKILL.md`]);
    });

    test("throws when a read fails, rather than returning empty instructions", async () => {
        await expect(build(fakeSandbox()).readFile(`${SHARED}/gone/SKILL.md`)).rejects.toThrow(
            "No such file",
        );
    });

    test("serves a whole discovery pass from one listing", async () => {
        const fake = fakeSandbox();
        const source = build(fake);

        // What one refresh does: list the roots, then stat and read each skill.
        await Promise.all([
            source.exists(SHARED),
            source.readdir(SHARED),
            source.stat(`${SHARED}/brand-voice`),
            source.exists(`${SHARED}/brand-voice/SKILL.md`),
            source.readdir(OWN),
            source.stat(`${OWN}/invoice-parse`),
        ]);

        expect(fake.calls.listTree).toBe(1);
    });

    test("re-reads the container once the snapshot expires", async () => {
        const fake = fakeSandbox();
        let clock = 0;
        const source = build(fake, () => clock);

        await source.exists(SHARED);
        clock = 1_000; // still inside the TTL
        await source.exists(SHARED);
        expect(fake.calls.listTree).toBe(1);

        clock = 5_000;
        fake.setTree([...TREE, entry(`${OWN}/just-installed`, "directory")]);
        await source.exists(SHARED);
        expect(fake.calls.listTree).toBe(2);
        // A skill the agent wrote itself shows up on the next turn.
        expect(await source.exists(`${OWN}/just-installed`)).toBe(true);
    });

    test("sees a skill the agent just installed, without waiting for the TTL", async () => {
        // The turn that writes a skill is the turn that wants to use it. Waiting
        // for a cache to expire would make self-installation feel broken.
        const fake = fakeSandbox();
        const source = build(fake, () => 0);

        await source.exists(SHARED);
        expect(await source.exists(`${OWN}/just-installed`)).toBe(false);

        fake.setTree([...TREE, entry(`${OWN}/just-installed`, "directory")]);
        fake.mutate();

        expect(await source.exists(`${OWN}/just-installed`)).toBe(true);
        expect(fake.calls.listTree).toBe(2);
    });

    test("reports no skills when the sandbox host is unreachable", async () => {
        // Chat has to survive a sandbox outage. An agent with no skills is
        // degraded; an agent that cannot start is broken.
        const fake = fakeSandbox();
        fake.failListing("connect ECONNREFUSED 127.0.0.1:3100");
        const source = build(fake);

        expect(await source.exists(SHARED)).toBe(false);
        await expect(source.readdir(SHARED)).rejects.toThrow("ENOENT");
    });

    test("never lists the parent of a root", async () => {
        // `/workspace` is not in the listing, so claiming to enumerate it would
        // report two skills directories as the whole workspace.
        await expect(build(fakeSandbox()).readdir("/workspace")).rejects.toThrow("ENOENT");
    });

    test("normalizes the paths Mastra joins", async () => {
        const source = build(fakeSandbox());

        expect(await source.exists(`${SHARED}//brand-voice/./SKILL.md`)).toBe(true);
        expect(await source.exists(`${SHARED}/brand-voice/`)).toBe(true);
        expect(await source.realpath(`${SHARED}//brand-voice/`)).toBe(`${SHARED}/brand-voice`);
    });

    test("marks a symlink instead of presenting it as a plain file", async () => {
        const fake = fakeSandbox([
            entry(SHARED, "directory"),
            entry(`${SHARED}/linked`, "file", { isSymlink: true }),
        ]);

        expect(await build(fake).readdir(SHARED)).toEqual([
            { name: "linked", type: "file", isSymlink: true },
        ]);
    });
});
