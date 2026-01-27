import {AvatarId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

// Avatar items persist after deletion to track changes via updateLockVersion.
// Lifecycle: null → {avatarId, content} → {avatarId: null, content: null}
// Making these properties nullable ensures we can detect deletions without losing change
// tracking.
export const AvatarSchema = Schema.object({
    /**
     * NOTE (ifitzsimmons, #avatar-version): I chose to use a `ChronologicalId` for the avatar
     * version to ensure idempotency and prevent race conditions during concurrent writes.
     *
     * Consider a case where two admins upload avatars at nearly the same time:
     *
     * 1. The edge service receives both requests and generates a unique, monotonically increasing
     *    version number (`ChronologicalId`) for each.
     * 2. Both requests are forwarded to the FileProcessorService to process the avatar images.
     * 3. Once processed, each result is uploaded to R2 under its versioned key.
     * 4. The edge service then attempts to update the avatar metadata in DynamoDB — but **only**
     *    if the new version is greater than the currently stored version.
     * 5. This ensures that only the avatar with the highest version number is persisted,
     *    regardless of the order in which the requests complete.
     *
     * The system remains **idempotent**: repeated or concurrent attempts to update the avatar will
     * converge on the same final state — the one with the latest version.
     *
     * See design document for more: https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/0d23mcm7xt551yn1fr0xw50p58
     */
    avatarId: Schema.id<AvatarId>().nullable().default(null),

    /**
     * The underlying bytes for a small version of the avatar image. Usually AVIF
     * but sometimes will be PNG (e.g. for automatically created space avatars from
     * Logo.dev). Always will be a web safe image format.
     *
     * Sometimes could be SVG (e.g. for `chatGptDefaultKnownBotAccountModelData`).
     */
    content: Schema.bytes.nullable().default(null),
});
export type Avatar = SchemaType<typeof AvatarSchema> & {version: number};

export const AvatarModelSchema = AvatarSchema.merge(
    Schema.object({
        // NOTE(ifitzsimmons, 2025-08-09):
        // The avatar model's version reflects when the avatar was last updated.
        // This corresponds to the DynamoDB item's updateLockVersion and enables us to
        // determine which avatar version to use when resolving the most current AccountModel.
        version: Schema.integer,
    }),
);
export type AvatarModel = SchemaType<typeof AvatarModelSchema>;

const avatarThemes = ["dark", "light"] as const;
export const AvatarThemeSchema = Schema.enum(avatarThemes);
export type AvatarTheme = SchemaType<typeof AvatarThemeSchema>;

export function isAvatarTheme(value: string): value is AvatarTheme {
    return avatarThemes.includes(value as AvatarTheme);
}

export type AvatarModelWithSignedUrl = AvatarModel & {url: string | null};
