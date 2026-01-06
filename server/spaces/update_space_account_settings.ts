import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {
    SpaceAccountSettings,
    SpaceAccountSettingsSchema,
} from "~/shared/spaces/space_account_settings.js";

/**
 * Update some space account settings for the actor in the provided space.
 */
export async function updateSpaceAccountSettings(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    update: Partial<SpaceAccountSettings>,
) {
    await authorizeSpaceAccess(context, spaceId);

    await SpacesTable.updateItem(
        context,
        {
            partitionType: "Space",
            sortRangeType: "AccountSettings",
            spaceId,
            accountId: context.actor.getAccountId(),
        },
        item => {
            item ??= {
                partitionType: "Space",
                sortRangeType: "AccountSettings",
                spaceId,
                accountId: context.actor.getAccountId(),
                ...SpaceAccountSettingsSchema.deserialize({}),
            };

            return {...item, ...update};
        },
    );
}
