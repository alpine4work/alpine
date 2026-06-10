import {getAccountSettingsItem} from "~/server/accounts/internal/get_account_settings_item.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {getOurAccountSpaceIds} from "~/server/spaces/get_our_account_space_ids.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Get the last opened `SpaceId` for the current session actor.
 */
export async function getOurLastOpenedSpaceId(
    context: ServerSessionActionContext,
): Promise<SpaceId | null> {
    const {lastOpenedSpaceId} = await getOurAccountSpaceIdsAndLastOpenedSpaceId(context);
    return lastOpenedSpaceId;
}

export async function getOurAccountSpaceIdsAndLastOpenedSpaceId(
    context: ServerSessionActionContext,
): Promise<{lastOpenedSpaceId: SpaceId | null; spaceIds: ReadonlySet<SpaceId>}> {
    const [accountSettingsItem, {spaceIds}] = await runAllPromises([
        getAccountSettingsItem(context, context.actor.getAccountId()),
        getOurAccountSpaceIds(context),
    ]);

    if (
        !accountSettingsItem?.lastOpenedSpaceId ||
        !spaceIds.has(accountSettingsItem.lastOpenedSpaceId)
    ) {
        return {
            lastOpenedSpaceId: spaceIds.size > 0 ? (spaceIds.values().next().value ?? null) : null,
            spaceIds,
        };
    }

    return {lastOpenedSpaceId: accountSettingsItem.lastOpenedSpaceId, spaceIds};
}
