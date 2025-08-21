import {AvatarModel} from "~/shared/avatar/avatar_schema.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function createTestSpaceModel(
    options: Partial<{
        id: SpaceId;
        name: string;
        version: number;
        alphaAccessDefaultChannelId: ChannelId;
        avatars: {
            darkTheme: AvatarModel;
            lightTheme: AvatarModel;
        };
    }> = {},
) {
    return new SpaceModel({
        id: options.id ?? generateId<SpaceId>(),
        name: "Test Space",
        version: 0,
        avatars: {
            darkTheme: null,
            lightTheme: null,
        },
        ...options,
    });
}
