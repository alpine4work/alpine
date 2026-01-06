import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    SpaceAccountSettings,
    SpaceAccountSettingsSchema,
} from "~/shared/spaces/space_account_settings.js";

/**
 * Get the space account settings for the actor in the provided space.
 */
export async function getSpaceAccountSettings(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<SpaceAccountSettings> {
    await authorizeSpaceAccess(context, spaceId);

    const item = await SpacesTable.getItemIfExists(context, {
        partitionType: "Space",
        sortRangeType: "AccountSettings",
        spaceId,
        accountId: context.actor.getAccountId(),
    });

    return item ?? SpaceAccountSettingsSchema.deserialize({});
}
