const TOOL_CATEGORIES = ["read", "edit", "execute", "mcp", "other"] as const;

type PermissionPolicy = "allow" | "ask" | "deny";
type ToolCategory = (typeof TOOL_CATEGORIES)[number];

interface ExecutionSession {
    state: {
        set(updates: { yolo?: boolean }): Promise<void>;
    };
    permissions: {
        setForCategory(input: {
            category: ToolCategory;
            policy: PermissionPolicy;
        }): Promise<void>;
        setForTool(input: {
            toolName: string;
            policy: PermissionPolicy;
        }): Promise<void>;
    };
}

/**
 * New agents stay inside the onboarding surface until their profile exists.
 * Established agents run in AgentController yolo mode: no approval gates.
 */
export async function configureSessionExecution(
    session: ExecutionSession,
    options: { onboarding: boolean; scheduleToolNames: string[] },
): Promise<void> {
    const categoryPolicy: PermissionPolicy = options.onboarding ? "deny" : "allow";

    await Promise.all([
        session.state.set({ yolo: !options.onboarding }),
        ...TOOL_CATEGORIES.map((category) =>
            session.permissions.setForCategory({ category, policy: categoryPolicy }),
        ),
        session.permissions.setForTool({
            toolName: "ask_user",
            policy: "allow",
        }),
        session.permissions.setForTool({
            toolName: "updateProfileTool",
            policy: "allow",
        }),
        ...options.scheduleToolNames.map((toolName) =>
            session.permissions.setForTool({
                toolName,
                policy: options.onboarding ? "deny" : "allow",
            }),
        ),
    ]);
}
