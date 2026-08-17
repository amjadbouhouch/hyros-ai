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
import {
    LocalFilesystem,
    Workspace,
    WORKSPACE_TOOLS,
    type AnyWorkspace,
} from "@mastra/core/workspace";
import { Memory } from "@mastra/memory";
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { agents } from "@hyros-ai/db";
import type { UserProfile } from "@hyros-ai/domain";
import { db } from "../lib/db.js";
import { HYROS_MODEL } from "../lib/model.js";
import {
    buildSendAgentMessageTool,
    replyTargetAgentIdFromSignalContent,
    type AgentMessageTarget,
} from "./agent-message.js";
import { createSandboxPoolFromEnv } from "../sandbox/pool.js";
import { formatAgentDirectory } from "./runtime-prompt.js";
import { buildUpdateProfileTool } from "./tools.js";
import { buildScheduleTools } from "./schedule-tools.js";
import { configureSessionExecution } from "./session-permissions.js";

export type AgentRow = typeof agents.$inferSelect;

interface AgentSessionState {
    yolo: boolean;
}

type Controller = AgentController<AgentSessionState>;
export type ChatSession = Awaited<ReturnType<Controller["createSession"]>>;

export interface AgentRuntime {
    row: AgentRow;
    controller: Controller;
    /** Get-or-create the (agent, owner) session, with onboarding permissions
     *  applied and any crash-surviving suspensions re-parked. */
    getSession(currentUser: UserProfile): Promise<ChatSession>;
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
- If updateProfileTool returns ok=false, follow its error exactly, choose a different valid name when requested, and call it again. Never claim a profile was saved when ok=false.
- After updateProfileTool succeeds, send one short message confirming who you have become.`;

const PERSONA_INSTRUCTIONS = `You are {{name}}. {{description}}`;

async function resolveAgentDirectory(row: AgentRow): Promise<string> {
    const otherAgents = await db.query.agents.findMany({
        columns: { slug: true, name: true, description: true },
        where: and(
            eq(agents.ownerId, row.ownerId),
            ne(agents.id, row.id),
            isNull(agents.archivedAt),
            isNotNull(agents.slug),
            isNotNull(agents.description),
        ),
        orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
    });
    return formatAgentDirectory(
        otherAgents.map((agent) => ({
            slug: agent.slug!,
            name: agent.name,
            description: agent.description!,
        })),
    );
}

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
    const [fresh, directory] = await Promise.all([
        db.query.agents.findFirst({ where: eq(agents.id, row.id) }),
        resolveAgentDirectory(row),
    ]);
    const current = fresh ?? row; // row vanished mid-flight: keep build-time snapshot
    if (!current.description) {
        return `${fillTemplate(SPAWN_INSTRUCTIONS, { name: current.name })}\n\n${directory}`;
    }
    return `${fillTemplate(PERSONA_INSTRUCTIONS, {
        name: current.name,
        description: current.description,
    })}\n\n${directory}`;
}

async function isOnboarding(row: AgentRow): Promise<boolean> {
    const fresh = await db.query.agents.findFirst({ where: eq(agents.id, row.id) });
    return !(fresh ?? row).description;
}

// ── sandbox ─────────────────────────────────────────────────────────────────

/**
 * Sandbox handles for every agent in this process, or null when no sandbox host
 * is configured (`SANDBOX_SERVICE_URL` unset) — which is how a dev machine or a
 * test run behaves.
 */
const sandboxPool = createSandboxPoolFromEnv();

/**
 * The agent's workspace: a shell inside its organization's container.
 *
 * The sandbox goes on as a static instance rather than a resolver, because Mastra
 * inspects a static one to pick tools — this provider has no process manager, so
 * the model gets exactly one foreground `execute_command`. A resolver would also
 * hand it `background`, `get_process_output` and `kill_process`, none of which
 * exist behind it. See apps/gateway/src/sandbox/hyros-sandbox.ts.
 *
 * No `filesystem` on purpose. Mastra's file tools would read and write the
 * gateway's own disk while commands ran in the container, and nothing in the
 * agent's view would distinguish the two. Until there is a filesystem backed by
 * the sandbox itself, files are the shell's business.
 *
 * Agents without a uid (an organization past the 64-agent pool) and hosts without
 * a sandbox service keep the previous local-directory workspace, so neither
 * situation takes chat down.
 */
function buildWorkspace(row: AgentRow): AnyWorkspace {
    if (!sandboxPool || row.sandboxUid === null) {
        return new Workspace({
            filesystem: new LocalFilesystem({ basePath: `./workspaces/${row.id}` }),
        });
    }

    return new Workspace({
        id: `agent:${row.id}`,
        name: `Sandbox (${row.name})`,
        sandbox: sandboxPool.resolveSandbox({
            organizationId: row.organizationId,
            agentId: row.id,
            uid: row.sandboxUid,
        }),
        // Nothing to sync: the container's volume is the only copy.
        autoSync: false,
    });
}

/**
 * Which permission category each tool falls into, so `session-permissions.ts`
 * can speak about them as a group.
 *
 * Without this every tool lands in `other`. Running shell commands is the one
 * capability that deserves its own category: it is denied for the length of
 * onboarding and allowed afterwards, and it is the switch to reach for if command
 * approval ever needs to come back.
 */
function resolveToolCategory(toolName: string): "read" | "edit" | "execute" | "mcp" | "other" | null {
    if (toolName === WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND) return "execute";
    // File tools join here as `read` / `edit` once a sandbox-backed filesystem
    // exists; today the workspace has none.
    return null;
}

// ── runtime construction ────────────────────────────────────────────────────

/** Promise-cached so concurrent first requests for one agent build once. */
const runtimes = new Map<string, Promise<AgentRuntime>>();

async function buildRuntime(row: AgentRow, mastra: Mastra): Promise<AgentRuntime> {
    const scheduleTools = buildScheduleTools({
        mastra,
        owner: { agentId: row.id, ownerId: row.ownerId },
    });
    async function targetEndpoint(
        targetRow: AgentRow,
        currentUser: UserProfile,
    ): Promise<AgentMessageTarget> {
        const runtime = await getRuntime({ row: targetRow, mastra });
        const session = await runtime.getSession(currentUser);
        return { row: targetRow, session };
    }

    const sendAgentMessage = buildSendAgentMessageTool({
        sourceAgentId: row.id,
        resolveTarget: async ({ targetAgentSlug, currentUser }) => {
            const targetRow = await db.query.agents.findFirst({
                where: and(
                    eq(agents.slug, targetAgentSlug),
                    eq(agents.ownerId, currentUser.id),
                    isNull(agents.archivedAt),
                    isNotNull(agents.description),
                ),
            });
            if (!targetRow) return null;
            return targetEndpoint(targetRow, currentUser);
        },
        resolveReplyTarget: async ({ inReplyTo, currentAgent, currentUser }) => {
            const messages = await db.execute<{ content: unknown }>(sql`
                select content
                from mastra_messages
                where id = ${inReplyTo}
                  and thread_id = ${currentAgent.id}
                  and "resourceId" = ${currentUser.id}
                  and role = 'signal'
                  and type = 'agent-message'
                limit 1
            `);
            const targetAgentId = replyTargetAgentIdFromSignalContent(
                messages[0]?.content,
                { inReplyTo, currentAgentId: currentAgent.id },
            );
            if (!targetAgentId) return null;
            const targetRow = await db.query.agents.findFirst({
                where: and(
                    eq(agents.id, targetAgentId),
                    eq(agents.ownerId, currentUser.id),
                    isNull(agents.archivedAt),
                    isNotNull(agents.slug),
                    isNotNull(agents.description),
                ),
            });
            if (!targetRow) return null;
            return targetEndpoint(targetRow, currentUser);
        },
    });
    const agent = new Agent({
        id: row.id,
        name: row.name,
        model: "zai-coding-plan/glm-4.7",
        instructions: () => resolveInstructions(row),
        tools: {
            updateProfileTool: buildUpdateProfileTool(row),
            sendAgentMessage,
            ...scheduleTools,
        },
    });

    const controller = new AgentController<AgentSessionState>({
        id: row.id,
        agent,
        // Seed before the thread subscription starts so a persisted approval
        // from an established agent is auto-approved while it is replayed.
        initialState: { yolo: Boolean(row.description) },
        // Shared storage from the gateway's Mastra instance — the controller
        // builds its own internal Mastra around it (see module doc).
        storage: mastra.getStorage(),
        // Runtime-created agents are not registered on the shared Mastra
        // instance, so pass its observability backend explicitly. This keeps
        // their agent, model, and tool spans in the same Langfuse service.
        observability: mastra.observability,
        memory: new Memory(),
        modes: [{ id: "default", name: "Default", metadata: { default: true } }],
        // A shell in this agent's own directory inside its organization's
        // container. Its instructions are injected into the system message by
        // Mastra, so the prompt needs no separate mention of it.
        workspace: buildWorkspace(row),
        toolCategoryResolver: resolveToolCategory,
    });
    await controller.init();

    async function getSession(currentUser: UserProfile): Promise<ChatSession> {
        if (currentUser.id !== row.ownerId) {
            throw new Error("currentUser does not own this agent");
        }
        const ownerId = currentUser.id;
        // Get-or-create per resource; threadId = agentId (plan §4 mapping).
        const session = await controller.createSession({
            id: `agent:${row.id}:owner:${ownerId}`,
            ownerId,
            resourceId: ownerId,
            threadId: row.id,
        });
        const onboarding = await isOnboarding(row);
        await configureSessionExecution(session, {
            onboarding,
            scheduleToolNames: Object.keys(scheduleTools),
        });
        // Crash recovery (TASK-021 spike-verified): suspended runs survive in
        // storage, but the session's parked-suspension registry is in-memory —
        // re-park here so the next user message resumes natively. Strict
        // resourceId match: never guess an owner from a thread id.
        const current = controller.getCurrentAgent(session) as unknown as {
            listSuspendedRuns(): Promise<{
                runs?: {
                    runId: string;
                    resourceId?: string;
                    toolCalls?: {
                        toolCallId: string;
                        toolName: string;
                        requiresApproval: boolean;
                    }[];
                }[];
            }>;
        };
        const { runs } = await current.listSuspendedRuns();
        for (const run of runs ?? []) {
            if (run.resourceId !== ownerId) continue;
            for (const tc of run.toolCalls ?? []) {
                // Approval runs replay through the controller subscription,
                // where yolo mode approves them. Only tool-defined suspend()
                // calls (for example ask_user) belong in this registry.
                if (tc.requiresApproval) continue;
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
