import {SpaceItem} from "~/server/spaces/internal/spaces_table.js";
import {createAvatarModelFromItem} from "~/shared/avatar/create_avatar_model_from_item.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function createSpaceModelFromItem(spaceItem: SpaceItem): SpaceModel {
    return new SpaceModel({
        id: spaceItem.spaceId,
        version: spaceItem.updateLockVersion ?? 0,
        name: spaceItem.name,
        themeColor: spaceItem.themeColor,
        databaseGroupId: spaceItem.databaseGroupId,
        avatars: {
            darkTheme: createAvatarModelFromItem(spaceItem.avatars.darkTheme),
            lightTheme: createAvatarModelFromItem(spaceItem.avatars.lightTheme),
        },
    });
}
