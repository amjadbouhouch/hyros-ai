import { db } from "../lib/db.js";
import { users } from "@hyros-ai/db";

import type { AuthUser } from "./guard.js";

/**
 * Upsert the app-level user profile from the verified Supabase auth token.
 *
 * The `users` table is keyed by the Supabase auth user id (uuid). On first
 * login the row is inserted; on subsequent logins the cached email/name/
 * avatarUrl are updated. Per agent-os-architecture.md §4 and schema.ts.
 *
 * Skipped: auto-provisioning the individual organization + membership at first
 * login (arch §2). Add when the tenancy flow needs it — the schema is ready.
 */
export async function upsertUser(user: AuthUser): Promise<void> {
    await db
        .insert(users)
        .values({
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl,
        })
        .onConflictDoUpdate({
            target: users.id,
            set: {
                email: user.email,
                name: user.name,
                avatarUrl: user.avatarUrl,
                updatedAt: new Date(),
            },
        });
}