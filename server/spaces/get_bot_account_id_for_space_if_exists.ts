import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeBotOperation} from "~/server/spaces/authorize_bot_operation.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * If the bot is instantiated in the provided `SpaceId` then return the `AccountId`
 * for the bot in the space.
 *
 * Throws if you don't have access to the space or permission to view the bot.
 */
export async function getBotAccountIdForSpaceIfExists(
    context: ServerActionContext,
    botId: BotId,
    spaceId: SpaceId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<AccountId | null> {
    // Both checks are required. Viewing a bot doesn't imply access to a space (anyone
    // may view a System owned bot) and space access doesn't imply the bot is visible
    // (an account owned bot is only visible to its owner).
    await authorizeSpaceAccess(context, spaceId);
    await authorizeBotOperation(context, botId, {type: "View"}, {consistency});

    const item = await SpacesTable.getItemIfExists(
        context,
        {
            partitionType: "Bot",
            sortRangeType: "Space",
            botId,
            spaceId,
        },
        {consistency},
    );

    return item?.accountId ?? null;
}
