import { describe, expect, test } from "bun:test";

import { buildTreeProbe, parseTreeOutput, TREE_MAX_DEPTH } from "./tree.js";

describe("tree probe", () => {
    test("skips a root that does not exist and still exits 0", () => {
        const probe = buildTreeProbe(["/workspace/.shared/skills"], 4);
        // A new agent has no skills directory yet; that is not a failure.
        expect(probe).toContain(`[ -d "$root" ] || continue`);
        expect(probe.endsWith("exit 0")).toBe(true);
    });

    test("quotes each root so a space or quote cannot split it", () => {
        const probe = buildTreeProbe(["/workspace/a b/skills", "/workspace/it's/skills"], 2);
        expect(probe).toContain(`'/workspace/a b/skills'`);
        expect(probe).toContain(`'/workspace/it'\\''s/skills'`);
    });

    test("clamps depth into range rather than trusting the caller", () => {
        expect(buildTreeProbe(["/w"], 99)).toContain(`-maxdepth ${TREE_MAX_DEPTH}`);
        expect(buildTreeProbe(["/w"], 0)).toContain("-maxdepth 1");
        expect(buildTreeProbe(["/w"], -3)).toContain("-maxdepth 1");
        expect(buildTreeProbe(["/w"], 2.7)).toContain("-maxdepth 2");
    });

    test("does not follow symlinks", () => {
        // `find -L` would invite a symlink loop and let a link out of the
        // workspace appear in the listing.
        expect(buildTreeProbe(["/w"], 4)).not.toContain("find -L");
    });
});

describe("tree output", () => {
    // Verbatim from `stat -c '%F|%s|%Y|%n'` in the sandbox image.
    const sample = [
        "directory|4096|1787002574|/workspace/a/skills",
        "directory|4096|1787002574|/workspace/a/skills/pdf-report",
        "regular file|812|1787002580|/workspace/a/skills/pdf-report/SKILL.md",
        "regular empty file|0|1787002581|/workspace/a/skills/pdf-report/notes.md",
        "symbolic link|11|1787002582|/workspace/a/skills/pdf-report/link",
        "",
    ].join("\n");

    test("reads type, size and mtime for each entry", () => {
        const { entries, truncated } = parseTreeOutput(sample);

        expect(truncated).toBe(false);
        expect(entries).toHaveLength(5);
        expect(entries[0]).toEqual({
            path: "/workspace/a/skills",
            type: "directory",
            size: 4096,
            modifiedAt: 1787002574,
        });
        expect(entries[2]).toEqual({
            path: "/workspace/a/skills/pdf-report/SKILL.md",
            type: "file",
            size: 812,
            modifiedAt: 1787002580,
        });
        // "regular empty file" is still a file.
        expect(entries[3]?.type).toBe("file");
    });

    test("marks a symlink instead of pretending it is a plain file", () => {
        const link = parseTreeOutput(sample).entries.at(-1);
        expect(link).toMatchObject({ type: "file", isSymlink: true });
    });

    test("splits on the first three delimiters, so a pipe in a name survives", () => {
        const { entries } = parseTreeOutput("regular file|4|123|/workspace/a/skills/we|ird.md");
        expect(entries[0]).toEqual({
            path: "/workspace/a/skills/we|ird.md",
            type: "file",
            size: 4,
            modifiedAt: 123,
        });
    });

    test("drops a line it cannot parse rather than inventing an entry", () => {
        const { entries } = parseTreeOutput(
            [
                "not a stat line at all",
                "regular file|nope|123|/workspace/a/x",
                "regular file|4|123|relative/path",
                "regular file|4|123|/workspace/a/good.md",
            ].join("\n"),
        );
        expect(entries.map((entry) => entry.path)).toEqual(["/workspace/a/good.md"]);
    });

    test("reports truncation instead of silently returning a partial tree", () => {
        const many = Array.from(
            { length: 10 },
            (_, index) => `regular file|1|1|/workspace/a/skills/f${index}`,
        ).join("\n");

        const { entries, truncated } = parseTreeOutput(many, 4);
        expect(entries).toHaveLength(4);
        expect(truncated).toBe(true);
    });
});
