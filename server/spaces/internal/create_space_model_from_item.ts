import {createAvatarModelFromItem} from "~/server/spaces/internal/create_avatar_model_from_item.js";
import {SpaceItem} from "~/server/spaces/internal/spaces_table.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function createSpaceModelFromItem(spaceItem: SpaceItem): SpaceModel {
    return new SpaceModel({
        id: spaceItem.spaceId,
        version: spaceItem.updateLockVersion ?? 0,
        name: spaceItem.name,
        alphaAccessDefaultChannelId: spaceItem.alphaAccessDefaultChannelId,
        avatars: {
            darkTheme: createAvatarModelFromItem(spaceItem.avatars.darkTheme),
            lightTheme: createAvatarModelFromItem(spaceItem.avatars.lightTheme),
        },
    });
}
