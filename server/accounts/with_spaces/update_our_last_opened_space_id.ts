import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {getInitialAccountSettingsItem} from "~/server/accounts/with_spaces/internal/get_initial_account_settings_item.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Updates our last opened `SpaceId`.
 */
export async function updateOurLastOpenedSpaceId(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<void> {
    await authorizeSpaceAccess(context, spaceId);

    await AccountsTable.updateItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "Settings",
            accountId: context.actor.getAccountId(),
        },
        item => {
            item ??= getInitialAccountSettingsItem(context.actor.getAccountId());
            if (item.lastOpenedSpaceId === spaceId) return item;
            return {
                ...item,
                lastOpenedSpaceId: spaceId,
            };
        },
    );
}
