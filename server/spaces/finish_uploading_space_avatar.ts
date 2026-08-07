import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {createSpaceModelFromItem} from "~/server/spaces/internal/create_space_model_from_item.js";
import {getSpaceItem} from "~/server/spaces/internal/get_space_item.js";
import {
    SpaceAvatarDarkThemeItem,
    SpaceAvatarLightThemeItem,
    SpaceItem,
    SpacesTable,
} from "~/server/spaces/internal/spaces_table.js";
import {AvatarTheme} from "~/shared/avatar/avatar_schema.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {AvatarId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export async function finishUploadingSpaceAvatar(
    context: ServerSessionActionContext,
    {
        spaceId,
        avatarContent,
        avatarId,
        avatarTheme,
    }: {
        spaceId: SpaceId;
        avatarContent: Uint8Array;
        avatarId: AvatarId;
        avatarTheme: AvatarTheme;
    },
): Promise<SpaceModel> {
    context.actor.authorizeSession();
    await authorizeSpaceAccess(context, spaceId, "Admin");

    return await context.dynamo.retryTransaction(async context => {
        const oldSpaceItem = await getSpaceItem(context, spaceId);
        const commonUpdateOptions = {
            spaceId,
            avatarContent,
            avatarId,
            oldSpaceItem,
        };

        switch (avatarTheme) {
            case "dark":
                return await dangerouslyFinishUploadingSpaceAvatarDarkTheme(
                    context,
                    commonUpdateOptions,
                );
            case "light":
                return await dangerouslyFinishUploadingSpaceAvatarLightTheme(
                    context,
                    commonUpdateOptions,
                );
            default:
                throw exhaustive(avatarTheme);
        }
    });
}

/**
 * Updates the space's Dark Theme Avatar WITHOUT ENSURING THE ACTOR IS AN ADMIN.
 *
 * Use `finishUploadingSpaceAvatar()` instead.
 */
async function dangerouslyFinishUploadingSpaceAvatarDarkTheme(
    context: ServerSessionActionContext,
    {
        spaceId,
        avatarContent,
        avatarId,
        oldSpaceItem,
    }: {
        spaceId: SpaceId;
        avatarContent: Uint8Array;
        avatarId: AvatarId;
        oldSpaceItem: SpaceItem;
    },
): Promise<SpaceModel> {
    const oldAvatarItem = oldSpaceItem.avatars.darkTheme;

    const newAvatarItem: SpaceAvatarDarkThemeItem = {
        ...oldAvatarItem,
        partitionType: "Space",
        sortRangeType: "AvatarDarkTheme",
        spaceId,
        avatarId,
        content: avatarContent,
    };

    const updatedAvatarItem = await SpacesTable.directlyUpdateItem(context, newAvatarItem);

    return createSpaceModelFromItem({
        ...oldSpaceItem,
        avatars: {
            ...oldSpaceItem.avatars,
            darkTheme: updatedAvatarItem,
        },
    });
}

/**
 * Updates the space's Light Theme Avatar WITHOUT ENSURING THE ACTOR IS AN ADMIN.
 *
 * Use `finishUploadingSpaceAvatar()` instead.
 */
async function dangerouslyFinishUploadingSpaceAvatarLightTheme(
    context: ServerSessionActionContext,
    {
        spaceId,
        avatarContent,
        avatarId,
        oldSpaceItem,
    }: {
        spaceId: SpaceId;
        avatarContent: Uint8Array;
        avatarId: AvatarId;
        oldSpaceItem: SpaceItem;
    },
): Promise<SpaceModel> {
    const oldAvatarItem = oldSpaceItem.avatars.lightTheme;

    const newAvatarItem: SpaceAvatarLightThemeItem = {
        ...oldAvatarItem,
        partitionType: "Space",
        sortRangeType: "AvatarLightTheme",
        spaceId,
        avatarId,
        content: avatarContent,
    };

    const updatedAvatarItem = await SpacesTable.directlyUpdateItem(context, newAvatarItem);

    return createSpaceModelFromItem({
        ...oldSpaceItem,
        avatars: {
            ...oldSpaceItem.avatars,
            lightTheme: updatedAvatarItem,
        },
    });
}
