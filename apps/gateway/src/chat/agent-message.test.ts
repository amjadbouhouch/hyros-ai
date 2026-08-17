import { describe, expect, test } from "bun:test";

import type { AgentSignal } from "@mastra/core/agent";

import {
    replyTargetAgentIdFromSignalContent,
    sendAgentPrompt,
    type AgentMessageToolDependencies,
} from "./agent-message.js";
import { createRuntimeContext, readRuntimeIdentity } from "./runtime-context.js";
import type { AgentRow } from "./runtime.js";

const OWNER_ID = "00000000-0000-0000-0000-000000000010";
const ORGANIZATION_ID = "00000000-0000-0000-0000-0000000000f0";
const SOURCE_ID = "00000000-0000-0000-0000-000000000011";
const TARGET_ID = "00000000-0000-0000-0000-000000000012";

const currentUser = {
    id: OWNER_ID,
    email: "owner@example.com",
    name: "Owner",
    avatarUrl: null,
};

function agentRow(id: string, name: string, slug: string): AgentRow {
    const now = new Date("2026-08-16T12:00:00.000Z");
    return {
        id,
        ownerId: OWNER_ID,
        organizationId: ORGANIZATION_ID,
        name,
        slug,
        description: `${name} description`,
        avatarUrl: null,
        sandboxUid: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
    };
}

function setup(
    action: "wake" | "deliver" | "blocked" | "missing" = "wake",
    awaitingUser: { approvalArmed?: boolean; suspensionPending?: boolean } = {},
) {
    const source = agentRow(SOURCE_ID, "Coordinator", "coordinator");
    const target = agentRow(TARGET_ID, "Project Manager", "project-manager");
    const deliveries: Array<{
        signal: AgentSignal;
        requestContext: unknown;
        requireDelivery?: boolean;
    }> = [];
    let targetResolutions = 0;
    let replyResolutions = 0;
    const endpoint = {
        row: target,
        session: {
            approval: {
                isArmed: () => Boolean(awaitingUser.approvalArmed),
            },
            suspensions: {
                hasPending: () => Boolean(awaitingUser.suspensionPending),
            },
            sendSignal(signal: AgentSignal, options?: Record<string, unknown>) {
                deliveries.push({
                    signal,
                    requestContext: options?.requestContext,
                    requireDelivery: options?.requireDelivery as boolean | undefined,
                });
                return {
                    id: signal.id ?? "missing",
                    type: signal.type,
                    accepted: Promise.resolve({
                        accepted: true as const,
                        ...(action === "missing" ? {} : { action }),
                        ...(action === "wake" || action === "deliver"
                            ? { runId: "run-123" }
                            : {}),
                    }),
                };
            },
        },
    };
    const dependencies: AgentMessageToolDependencies = {
        sourceAgentId: SOURCE_ID,
        createId: () => "00000000-0000-0000-0000-000000000099",
        resolveTarget: async ({ targetAgentSlug, currentUser: resolvedUser }) => {
            targetResolutions += 1;
            expect(targetAgentSlug).toBe("project-manager");
            expect(resolvedUser).toEqual(currentUser);
            return endpoint;
        },
        resolveReplyTarget: async ({ inReplyTo, currentAgent, currentUser: user }) => {
            replyResolutions += 1;
            expect(inReplyTo).toBe("request-signal-42");
            expect(currentAgent.id).toBe(SOURCE_ID);
            expect(user).toEqual(currentUser);
            return endpoint;
        },
    };
    return {
        source,
        target,
        deliveries,
        dependencies,
        requestContext: createRuntimeContext(source, currentUser),
        counts: () => ({ targetResolutions, replyResolutions }),
    };
}

describe("agent messaging", () => {
    test("accepts only a reply correlation matching the persisted signal envelope", () => {
        const content = {
            format: 2,
            metadata: {
                signal: {
                    id: "request-signal-42",
                    tagName: "agent-message",
                    attributes: {
                        messageId: "request-signal-42",
                        expectsReply: true,
                    },
                    metadata: {
                        protocol: "hyros-agent-message-v1",
                        messageId: "request-signal-42",
                        replyToAgentId: TARGET_ID,
                        targetAgentId: SOURCE_ID,
                        expectsReply: true,
                    },
                },
            },
        };

        expect(
            replyTargetAgentIdFromSignalContent(content, {
                inReplyTo: "request-signal-42",
                currentAgentId: SOURCE_ID,
            }),
        ).toBe(TARGET_ID);
        expect(
            replyTargetAgentIdFromSignalContent(content, {
                inReplyTo: "forged-message-id",
                currentAgentId: SOURCE_ID,
            }),
        ).toBeNull();
        expect(
            replyTargetAgentIdFromSignalContent(content, {
                inReplyTo: "request-signal-42",
                currentAgentId: TARGET_ID,
            }),
        ).toBeNull();
    });

    test("keeps complete currentAgent and currentUser runtime-context objects", () => {
        const { source, requestContext } = setup();

        expect(readRuntimeIdentity(requestContext, SOURCE_ID)).toEqual({
            currentAgent: {
                id: source.id,
                ownerId: source.ownerId,
                name: source.name,
                slug: source.slug,
                description: source.description,
                avatarUrl: source.avatarUrl,
            },
            currentUser,
        });
    });

    test("resolves a new recipient from its canonical per-user name address", async () => {
        const { target, deliveries, dependencies, requestContext } = setup();

        const result = await sendAgentPrompt(
            {
                kind: "message",
                targetAgentName: "Project Manager",
                prompt: "Investigate the failed deployment.",
                replyMode: "required",
            },
            requestContext,
            dependencies,
        );

        expect(result).toEqual({
            delivered: true,
            code: "DELIVERED",
            message: "Message delivered to Project Manager.",
            messageId: "00000000-0000-0000-0000-000000000099",
            targetAgentSlug: "project-manager",
            targetAgentName: "Project Manager",
            action: "wake",
            runId: "run-123",
        });
        const delivery = deliveries[0]!;
        expect(delivery.requireDelivery).toBe(true);
        expect(delivery.signal).toMatchObject({
            contents: "Investigate the failed deployment.",
            attributes: {
                replyToAgentName: "Coordinator",
                expectsReply: true,
            },
            metadata: {
                replyToAgentId: SOURCE_ID,
                targetAgentId: TARGET_ID,
            },
        });
        expect(delivery.signal.attributes).not.toHaveProperty("replyToAgentId");
        expect(readRuntimeIdentity(delivery.requestContext as never, TARGET_ID)).toEqual({
            currentAgent: {
                id: target.id,
                ownerId: target.ownerId,
                name: target.name,
                slug: target.slug,
                description: target.description,
                avatarUrl: target.avatarUrl,
            },
            currentUser,
        });
    });

    test("supports fire-and-forget without inviting a reply", async () => {
        const { deliveries, dependencies, requestContext } = setup();

        await sendAgentPrompt(
            {
                kind: "message",
                targetAgentName: "Project Manager",
                prompt: "Just saying hello.",
                replyMode: "none",
            },
            requestContext,
            dependencies,
        );

        expect(deliveries[0]?.signal).toMatchObject({
            attributes: { expectsReply: false },
            metadata: { expectsReply: false },
        });
    });

    test("derives a reply recipient from the trusted original signal", async () => {
        const { deliveries, dependencies, requestContext, counts } = setup("deliver");

        const result = await sendAgentPrompt(
            {
                kind: "reply",
                prompt: "The deployment token expired.",
                inReplyTo: "request-signal-42",
            },
            requestContext,
            dependencies,
        );

        expect(counts()).toEqual({ targetResolutions: 0, replyResolutions: 1 });
        expect(result.inReplyTo).toBe("request-signal-42");
        expect(deliveries[0]?.signal).toMatchObject({
            attributes: { expectsReply: false, inReplyTo: "request-signal-42" },
            metadata: { expectsReply: false, inReplyTo: "request-signal-42" },
        });
    });

    test("does not send or substitute another recipient when a name is missing", async () => {
        const { dependencies, requestContext, deliveries } = setup();
        dependencies.resolveTarget = async () => null;

        const result = await sendAgentPrompt(
            {
                kind: "message",
                targetAgentName: "Unknown Agent",
                prompt: "Hello.",
                replyMode: "none",
            },
            requestContext,
            dependencies,
        );

        expect(result).toMatchObject({
            delivered: false,
            code: "TARGET_NOT_FOUND",
        });
        expect(result.message).toContain("No message was sent");
        expect(deliveries).toHaveLength(0);
    });

    test("reports a blocked target without pretending delivery succeeded", async () => {
        const { dependencies, requestContext } = setup("blocked");

        const result = await sendAgentPrompt(
            {
                kind: "message",
                targetAgentName: "Project Manager",
                prompt: "Please review this.",
                replyMode: "none",
            },
            requestContext,
            dependencies,
        );

        expect(result).toMatchObject({
            delivered: false,
            code: "DELIVERY_NOT_ACCEPTED",
            action: "blocked",
        });
    });

    test("treats a missing routing decision as undelivered", async () => {
        const { dependencies, requestContext } = setup("missing");

        const result = await sendAgentPrompt(
            {
                kind: "message",
                targetAgentName: "Project Manager",
                prompt: "Please review this.",
                replyMode: "none",
            },
            requestContext,
            dependencies,
        );

        expect(result).toMatchObject({
            delivered: false,
            code: "DELIVERY_NOT_ACCEPTED",
            action: "unknown",
        });
    });

    test("does not interrupt a target parked on a tool approval", async () => {
        const { dependencies, requestContext, deliveries } = setup("wake", {
            approvalArmed: true,
        });

        const result = await sendAgentPrompt(
            {
                kind: "message",
                targetAgentName: "Project Manager",
                prompt: "Please review this.",
                replyMode: "required",
            },
            requestContext,
            dependencies,
        );

        expect(result).toMatchObject({
            delivered: false,
            code: "TARGET_AWAITING_USER",
            targetAgentSlug: "project-manager",
        });
        expect(deliveries).toHaveLength(0);
    });

    test("does not interrupt a target waiting on an ask_user answer", async () => {
        const { dependencies, requestContext, deliveries } = setup("wake", {
            suspensionPending: true,
        });

        const result = await sendAgentPrompt(
            {
                kind: "reply",
                prompt: "The deployment token expired.",
                inReplyTo: "request-signal-42",
            },
            requestContext,
            dependencies,
        );

        expect(result).toMatchObject({
            delivered: false,
            code: "TARGET_AWAITING_USER",
            inReplyTo: "request-signal-42",
        });
        expect(deliveries).toHaveLength(0);
    });

    test("rejects self-messaging before target resolution", async () => {
        const { dependencies, requestContext, deliveries, counts } = setup();

        const result = await sendAgentPrompt(
            {
                kind: "message",
                targetAgentName: "Coordinator",
                prompt: "Talk to yourself.",
                replyMode: "none",
            },
            requestContext,
            dependencies,
        );

        expect(result).toMatchObject({ delivered: false, code: "SELF_TARGET" });
        expect(counts().targetResolutions).toBe(0);
        expect(deliveries).toHaveLength(0);
    });
});
