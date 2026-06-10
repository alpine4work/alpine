import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {createSpaceModelFromItem} from "~/server/spaces/internal/create_space_model_from_item.js";
import {getSpaceItem} from "~/server/spaces/internal/get_space_item.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {SelectableSpaceThemeColor} from "~/shared/design/core/theme_colors.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export async function updateSpaceThemeColor(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    themeColor: SelectableSpaceThemeColor,
): Promise<SpaceModel> {
    await authorizeSpaceAccess(context, spaceId, "Admin");

    return await context.dynamo.retryTransaction(async context => {
        const spaceItem = await getSpaceItem(context, spaceId);

        const newSpaceAttributesItem = {
            ...spaceItem,
            themeColor,
        };

        const updatedSpaceItem = await SpacesTable.directlyUpdateItem(
            context,
            newSpaceAttributesItem,
        );

        return createSpaceModelFromItem({
            ...updatedSpaceItem,
            avatars: spaceItem.avatars,
        });
    });
}
