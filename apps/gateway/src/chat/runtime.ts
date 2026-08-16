/**
 * Chat runtime — request-driven construction of agent runtimes (rework of
 * TASK-023 after the two-axis review).
 *
 * Design (user decision): no boot-synced registry. When a chat request arrives,
 * we load the agent row and build (or reuse) its runtime here. The gateway's
 * shared Mastra instance is passed in as an argument; controllers are NOT
 * registered on it — verified in @mastra/core@1.59 source (`runInit()`: when
 * `config.storage` is set and no external Mastra was registered, the controller
 * builds its own internal Mastra around that storage). Registration only powers
 * Mastra's HTTP route surface (/mastra/api/agents), which dynamic DB-backed
 * agents never use — our own /chat route is their surface.
 */

import { Agent } from "@mastra/core/agent";
import { AgentController } from "@mastra/core/agent-controller";
import type { Mastra } from "@mastra/core/mastra";
import { LocalFilesystem, Workspace } from "@mastra/core/workspace";
import { Memory } from "@mastra/memory";
import { eq } from "drizzle-orm";

import { agents } from "@hyros-ai/db";
import { db } from "../lib/db.js";
import { HYROS_MODEL } from "../lib/model.js";
import { buildUpdateProfileTool } from "./tools.js";
import { buildScheduleTools } from "./schedule-tools.js";

export type AgentRow = typeof agents.$inferSelect;

type Controller = AgentController;
export type ChatSession = Awaited<ReturnType<Controller["createSession"]>>;

export interface AgentRuntime {
    row: AgentRow;
    controller: Controller;
    /** Get-or-create the (agent, owner) session, with onboarding permissions
     *  applied and any crash-surviving suspensions re-parked. */
    getSession(ownerId: string): Promise<ChatSession>;
}

// ── instructions (persona is a function of the DB row, re-read per call) ─────

const SPAWN_INSTRUCTIONS = `You are {{name}}, a Hyros AI agent that has just been created by your user.
Right now your only job is onboarding: get to know your creator and define who you are.

Rules:
- Interview via the ask_user tool — one focused question per call. Never ask in plain text.
- Every ask_user call must include 2-4 concise suggested options with short descriptions. Use single_select; the host always also offers free text for "something else".
- Do not inspect the workspace or call any other tool during onboarding.
- Learn at least: what to call you (a short display name), what you are for, and the tone you should use.
- Keep it to 2-4 questions, then call updateProfileTool with the final name, a 1-2 sentence description (third person: what you do and how you behave), and an avatar object with both style and config.
- Pick the avatar style deliberately: adventurer/avataaars/lorelei/notionists for illustrated people, bottts for a robot, clay for a soft character, fun-emoji/thumbs for playful identities, pixel-art for retro, or identicon for abstract/geometric.
- Avatar config must include a stable seed. A seed selects a deterministic variation; it does not understand descriptive phrases. You may also set common DiceBear options such as backgroundColor (hex without #), borderRadius (0-50), flip, rotate, or scale. Example: {"style":"bottts","config":{"seed":"agent-7f2a","backgroundColor":"dbeafe","borderRadius":16}}.
- After updateProfileTool succeeds, send one short message confirming who you have become.`;

const PERSONA_INSTRUCTIONS = `You are {{name}}. {{description}}`;

/** Single placeholder filler shared by both templates ({{key}} interpolation). */
function fillTemplate(template: string, vars: Record<string, string>): string {
    return Object.entries(vars).reduce(
        (t, [key, value]) => t.replaceAll(`{{${key}}}`, value),
        template,
    );
}

/**
 * Resolve instructions from the CURRENT row state: no description yet → spawn
 * (onboarding) instructions; description set → persona. Re-reads the row so an
 * update_profile mid-conversation flips the persona on the very next turn.
 */
async function resolveInstructions(row: AgentRow): Promise<string> {
    const fresh = await db.query.agents.findFirst({ where: eq(agents.id, row.id) });
    const current = fresh ?? row; // row vanished mid-flight: keep build-time snapshot
    if (!current.description) {
        return fillTemplate(SPAWN_INSTRUCTIONS, { name: current.name });
    }
    return fillTemplate(PERSONA_INSTRUCTIONS, {
        name: current.name,
        description: current.description,
    });
}

async function isOnboarding(row: AgentRow): Promise<boolean> {
    const fresh = await db.query.agents.findFirst({ where: eq(agents.id, row.id) });
    return !(fresh ?? row).description;
}

// ── runtime construction ────────────────────────────────────────────────────

/** Promise-cached so concurrent first requests for one agent build once. */
const runtimes = new Map<string, Promise<AgentRuntime>>();

async function buildRuntime(row: AgentRow, mastra: Mastra): Promise<AgentRuntime> {
    const scheduleTools = buildScheduleTools({
        mastra,
        owner: { agentId: row.id, ownerId: row.ownerId },
    });
    const agent = new Agent({
        id: row.id,
        name: row.name,
        model: HYROS_MODEL,
        instructions: () => resolveInstructions(row),
        tools: { updateProfileTool: buildUpdateProfileTool(row), ...scheduleTools },
    });

    const controller = new AgentController({
        id: row.id,
        agent,
        // Shared storage from the gateway's Mastra instance — the controller
        // builds its own internal Mastra around it (see module doc).
        storage: mastra.getStorage(),
        memory: new Memory(),
        modes: [{ id: "default", name: "Default", metadata: { default: true } }],
        workspace: new Workspace({
            filesystem: new LocalFilesystem({ basePath: `./workspaces/${row.id}` }),
        }),
    });
    await controller.init();

    async function getSession(ownerId: string): Promise<ChatSession> {
        // Get-or-create per resource; threadId = agentId (plan §4 mapping).
        const session = await controller.createSession({
            id: `agent:${row.id}:owner:${ownerId}`,
            ownerId,
            resourceId: ownerId,
            threadId: row.id,
        });
        // A small model can ignore the onboarding prompt and reach for the
        // workspace. The desktop approval UI is not part of onboarding, so
        // deny every tool category until the profile exists, then restore the
        // controller's normal ask-before-tool policy on the following turn.
        const onboarding = await isOnboarding(row);
        const categoryPolicy = onboarding ? "deny" : "ask";
        await Promise.all(
            (["read", "edit", "execute", "mcp", "other"] as const).map((category) =>
                session.permissions.setForCategory({ category, policy: categoryPolicy }),
            ),
        );
        // These two tools are the complete onboarding surface. Per-tool rules
        // override the category policy above.
        await Promise.all([
            session.permissions.setForTool({ toolName: "ask_user", policy: "allow" }),
            session.permissions.setForTool({
                toolName: "updateProfileTool",
                policy: onboarding ? "allow" : "ask",
            }),
            ...Object.keys(scheduleTools).map((toolName) =>
                session.permissions.setForTool({
                    toolName,
                    policy: onboarding ? "deny" : "allow",
                }),
            ),
        ]);
        // Crash recovery (TASK-021 spike-verified): suspended runs survive in
        // storage, but the session's parked-suspension registry is in-memory —
        // re-park here so the next user message resumes natively. Strict
        // resourceId match: never guess an owner from a thread id.
        const current = controller.getCurrentAgent(session) as unknown as {
            listSuspendedRuns(): Promise<{
                runs?: {
                    runId: string;
                    resourceId?: string;
                    toolCalls?: { toolCallId: string; toolName: string }[];
                }[];
            }>;
        };
        const { runs } = await current.listSuspendedRuns();
        for (const run of runs ?? []) {
            if (run.resourceId !== ownerId) continue;
            for (const tc of run.toolCalls ?? []) {
                session.suspensions.register({ ...tc, runId: run.runId });
            }
        }
        return session;
    }

    return { row, controller, getSession };
}

/**
 * Get (or lazily build) the runtime for an agent row. Built on demand at
 * request time — there is deliberately no boot-time sync of the agents table.
 */
export function getRuntime(args: { row: AgentRow; mastra: Mastra }): Promise<AgentRuntime> {
    const cached = runtimes.get(args.row.id);
    if (cached) return cached;
    const building = buildRuntime(args.row, args.mastra).catch((e) => {
        runtimes.delete(args.row.id); // don't cache a broken build
        throw e;
    });
    runtimes.set(args.row.id, building);
    return building;
}
