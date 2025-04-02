import {ServerActionContext} from "~/server/context/server_action_context.js";
import {dangerouslyFavoriteSearchEntityWithoutAuthorization} from "~/server/search/data/table/search_entity_table.js";
import {internalDangerouslyAddSpaceAccountAsAdmin} from "~/server/spaces/spaces_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Add an account to some space. Only administrators may call this method. But
 * administrators beware! Adding an account to a space gives the account access
 * to data within the space. Make sure you've been given permission by the
 * space owner before adding anyone new to their space.
 */
export async function dangerouslyAddSpaceAccountAsAdmin(
    context: ServerActionContext,
    {
        spaceId,
        accountId,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
    },
) {
    await internalDangerouslyAddSpaceAccountAsAdmin(context, {
        spaceId,
        accountId,
        favoriteSearchEntity: (
            context,
            {spaceId: otherSpaceId, accountId: otherAccountId, entityId},
        ) => {
            // Double check to make sure the function is only favoriting entities for the
            // account we're adding.
            assert(otherSpaceId === spaceId);
            assert(otherAccountId === accountId);

            return dangerouslyFavoriteSearchEntityWithoutAuthorization(context, {
                spaceId: otherSpaceId,
                accountId: otherAccountId,
                entityId,
            });
        },
    });
}
