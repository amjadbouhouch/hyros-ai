import { describe, expect, test } from "bun:test";

import { configureSessionExecution } from "./session-permissions.js";

function permissionRecorder() {
    const states: { yolo?: boolean }[] = [];
    const categories = new Map<string, string>();
    const tools = new Map<string, string>();

    return {
        states,
        categories,
        tools,
        session: {
            state: {
                async set(updates: { yolo?: boolean }) {
                    states.push(updates);
                },
            },
            permissions: {
                async setForCategory(input: { category: string; policy: string }) {
                    categories.set(input.category, input.policy);
                },
                async setForTool(input: { toolName: string; policy: string }) {
                    tools.set(input.toolName, input.policy);
                },
            },
        },
    };
}

describe("configureSessionExecution", () => {
    test("runs an established agent in yolo mode with every tool allowed", async () => {
        const recorder = permissionRecorder();

        await configureSessionExecution(recorder.session, {
            onboarding: false,
            scheduleToolNames: ["createSchedule", "deleteSchedule"],
        });

        expect(recorder.states).toEqual([{ yolo: true }]);
        expect([...recorder.categories.values()]).toEqual([
            "allow",
            "allow",
            "allow",
            "allow",
            "allow",
        ]);
        expect(Object.fromEntries(recorder.tools)).toEqual({
            ask_user: "allow",
            updateProfileTool: "allow",
            createSchedule: "allow",
            deleteSchedule: "allow",
        });
    });

    test("keeps a new agent inside its onboarding tools", async () => {
        const recorder = permissionRecorder();

        await configureSessionExecution(recorder.session, {
            onboarding: true,
            scheduleToolNames: ["createSchedule"],
        });

        expect(recorder.states).toEqual([{ yolo: false }]);
        expect([...recorder.categories.values()]).toEqual([
            "deny",
            "deny",
            "deny",
            "deny",
            "deny",
        ]);
        expect(Object.fromEntries(recorder.tools)).toEqual({
            ask_user: "allow",
            updateProfileTool: "allow",
            createSchedule: "deny",
        });
    });
});
