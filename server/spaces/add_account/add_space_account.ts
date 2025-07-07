import {ServerActionContext} from "~/server/context/server_action_context.js";
import {dangerouslyFavoriteSearchEntityWithoutAuthorization} from "~/server/search/data/table/search_entity_table.js";
import {
    internalAddSpaceAccount,
    internalDangerouslyAddSpaceAccountAsAdmin,
} from "~/server/spaces/spaces_table.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Add an account to some space. Only space admins may call this method.
 */
export function addSpaceAccount(
    context: ServerActionContext,
    {
        spaceId,
        accountId,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
    },
): Promise<AccountModel> {
    return internalAddSpaceAccount(context, {
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

// TODO(calebmer): Delete this ASAP. We need it while we're still in our alpha
// period but it's dangerous to let Alpine employees add arbitrary accounts to
// any space.
export function dangerouslyAddSpaceAccountAsAdmin(
    context: ServerActionContext,
    {
        spaceId,
        accountId,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
    },
): Promise<AccountModel> {
    return internalDangerouslyAddSpaceAccountAsAdmin(context, {
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
