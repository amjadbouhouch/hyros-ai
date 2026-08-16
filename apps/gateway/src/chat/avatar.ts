import { Avatar, Style } from "@dicebear/core";
import adventurerDefinition from "@dicebear/styles/adventurer.json" with { type: "json" };
import avataaarsDefinition from "@dicebear/styles/avataaars.json" with { type: "json" };
import botttsDefinition from "@dicebear/styles/bottts.json" with { type: "json" };
import clayDefinition from "@dicebear/styles/clay.json" with { type: "json" };
import funEmojiDefinition from "@dicebear/styles/fun-emoji.json" with { type: "json" };
import identiconDefinition from "@dicebear/styles/identicon.json" with { type: "json" };
import loreleiDefinition from "@dicebear/styles/lorelei.json" with { type: "json" };
import notionistsDefinition from "@dicebear/styles/notionists.json" with { type: "json" };
import pixelArtDefinition from "@dicebear/styles/pixel-art.json" with { type: "json" };
import thumbsDefinition from "@dicebear/styles/thumbs.json" with { type: "json" };
import { z } from "zod";

export const AVATAR_STYLES = [
    "adventurer",
    "avataaars",
    "bottts",
    "clay",
    "fun-emoji",
    "identicon",
    "lorelei",
    "notionists",
    "pixel-art",
    "thumbs",
] as const;

const styles: Record<(typeof AVATAR_STYLES)[number], Style> = {
    adventurer: new Style(adventurerDefinition),
    avataaars: new Style(avataaarsDefinition),
    bottts: new Style(botttsDefinition),
    clay: new Style(clayDefinition),
    "fun-emoji": new Style(funEmojiDefinition),
    identicon: new Style(identiconDefinition),
    lorelei: new Style(loreleiDefinition),
    notionists: new Style(notionistsDefinition),
    "pixel-art": new Style(pixelArtDefinition),
    thumbs: new Style(thumbsDefinition),
};

const avatarOptionValueSchema = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.array(z.number()),
    z.record(z.string(), z.number()),
]);

/**
 * DiceBear options are style-dependent. Core validates the final object against
 * the selected definition; this schema preserves the JSON value shapes used by
 * both common options and weighted style-specific variants.
 */
export const avatarConfigSchema = z
    .object({
        seed: z.string().trim().min(1).max(128),
    })
    .catchall(avatarOptionValueSchema);

export const avatarSelectionSchema = z.object({
    style: z.enum(AVATAR_STYLES),
    config: avatarConfigSchema,
});

export type AvatarSelection = z.infer<typeof avatarSelectionSchema>;

/** Render the exact selected style/config locally; no remote DiceBear URL. */
export function renderAvatarDataUri(selection: AvatarSelection): string {
    try {
        const parsed = avatarSelectionSchema.parse(selection);
        return new Avatar(styles[parsed.style], parsed.config).toDataUri();
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid DiceBear config for ${selection.style}: ${reason}`, {
            cause: error,
        });
    }
}
