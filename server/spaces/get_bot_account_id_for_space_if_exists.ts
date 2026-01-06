import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * If the bot is instantiated in the provided `SpaceId` then return the
 * `AccountId` for the bot in the space.
 *
 * Throws if you don't have access to the space.
 */
export async function getBotAccountIdForSpaceIfExists(
    context: ServerActionContext,
    botId: BotId,
    spaceId: SpaceId,
): Promise<AccountId | null> {
    await authorizeSpaceAccess(context, spaceId);

    const item = await SpacesTable.getItemIfExists(context, {
        partitionType: "Bot",
        sortRangeType: "Space",
        botId,
        spaceId,
    });

    return item?.accountId ?? null;
}
