import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getSpaceItem} from "~/server/spaces/internal/get_space_item.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Get the theme color for a space.
 *
 * This is safe to call without authorization since theme color is not sensitive
 * information and is used for UI styling purposes only.
 */
export async function getSpaceThemeColor(
    context: DynamoContext,
    spaceId: SpaceId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<ThemeColor> {
    const spaceItem = await getSpaceItem(context, spaceId, {consistency});
    return spaceItem.themeColor;
}
