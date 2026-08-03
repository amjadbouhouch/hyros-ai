import { Agent } from "@mastra/core/agent";

/**
 * The default Hyros AI agent.
 *
 * A minimal, tool-less agent registered so the Mastra runtime has something to
 * serve through the `/mastra` mount (e.g. `GET /mastra/api/agents`). The
 * `model` is a Mastra "magic string" (`provider/model-name`); API keys are read
 * from env vars automatically (e.g. `OPENAI_API_KEY` for openai/*). The default
 * can be overridden at deploy time via `MASTRA_MODEL`.
 */
export const supportAgent = new Agent({
    id: "support-agent",
    name: "Hyros Agent",
    description: "The default Hyros AI agent.",
    instructions: "You are the Hyros AI assistant. Help the user with their request.",
    model: process.env.MASTRA_MODEL ?? "openai/gpt-4o-mini",
});
