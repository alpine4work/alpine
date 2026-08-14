import {AvatarModel} from "~/shared/avatar/avatar_schema.js";
import {AvatarId} from "~/shared/id/types/id_types.js";

export function createAvatarModelFromItem(
    avatarItem: {
        avatarId: AvatarId | null;
        content: Uint8Array | null;
        updateLockVersion?: number | undefined;
    } | null,
): AvatarModel | null {
    if (!avatarItem) return null;

    return {
        avatarId: avatarItem.avatarId,
        version: avatarItem.updateLockVersion ?? 0,
        content: avatarItem.content,
    };
}
