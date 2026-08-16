import { Agent } from "@mastra/core/agent";

import { HYROS_MODEL } from "../../lib/model.js";

/**
 * The default Hyros AI agent.
 *
 * A minimal, tool-less agent registered so the Mastra runtime has something to
 * serve through the `/mastra` mount (e.g. `GET /mastra/api/agents`). The
 * `model` is the shared inlined constant (see lib/model.ts) — env model
 * selection was removed.
 */
export const supportAgent = new Agent({
    id: "support-agent",
    name: "Hyros Agent",
    description: "The default Hyros AI agent.",
    instructions: "You are the Hyros AI assistant. Help the user with their request.",
    model: HYROS_MODEL,
});
