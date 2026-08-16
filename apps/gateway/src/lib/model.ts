import type { OpenAICompatibleConfig } from "@mastra/core/llm";

const apiKey = process.env.HYROS_OPENAI_API_KEY;

if (!apiKey) {
    throw new Error("HYROS_OPENAI_API_KEY is required by the gateway agent runtime");
}

/** The single OpenAI-compatible model configuration used by every Hyros agent. */
export const HYROS_MODEL = {
    providerId: "hyros-local",
    modelId: process.env.HYROS_MODEL_ID ?? "hyros-ai",
    url: process.env.HYROS_OPENAI_BASE_URL ?? "http://localhost:20128/v1",
    apiKey,
} satisfies OpenAICompatibleConfig;
