import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {Context} from "~/shared/context/context.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Gets all of the space accounts for a given bot (which spaces is the bot
 * instantiated in and under which `AccountId`?).
 *
 * We don't check that the actor is authorized to perform this action! For right
 * now, there aren't many reasons for you to call this function. If you _do_ need
 * to call this function, you should make sure that the actor has internal access
 * somewhere along the call chain.
 */
export async function* dangerouslyGetAllSpaceAccountsForBot(
    context: Context<DynamoContextModules>,
    botId: BotId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): AsyncGenerator<{spaceId: SpaceId; accountId: AccountId}> {
    for await (const item of SpacesTable.query(context, {
        limit: "All",
        partitionKey: {
            partitionType: "Bot",
            botId,
        },
        consistency,
    })) {
        yield {spaceId: item.spaceId, accountId: item.accountId};
    }
}
