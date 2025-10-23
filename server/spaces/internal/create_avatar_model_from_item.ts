import {
    SpaceAccountAvatarOverrideItem,
    SpaceAvatarDarkThemeItem,
    SpaceAvatarLightThemeItem,
} from "~/server/spaces/internal/spaces_table.js";
import {AvatarModel} from "~/shared/avatar/avatar_schema.js";

export function createAvatarModelFromItem(
    avatarItem:
        | SpaceAvatarDarkThemeItem
        | SpaceAvatarLightThemeItem
        | SpaceAccountAvatarOverrideItem
        | null,
): AvatarModel | null {
    if (!avatarItem) return null;

    return {
        avatarId: avatarItem.avatarId,
        version: avatarItem.updateLockVersion ?? 0,
        content: avatarItem.content,
    };
}
