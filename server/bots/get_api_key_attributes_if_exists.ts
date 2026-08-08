import {BotsTable} from "~/server/bots/internal/bots_table.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {ApiKey} from "~/shared/id/api_key.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get the information associated with an `ApiKey`. Like what bot the `ApiKey` is
 * for and what `SpaceId` the `ApiKey` is for. If null then there's no `ApiKey` and
 * our API shouldn't grant access for the `ApiKey`.
 *
 * This isn't dangerous since if an attacker has a user's `ApiKey` then the user is
 * already cooked. Every user has access, through the API, to know whether their
 * API key is valid or not.
 */
export async function getApiKeyAttributesIfExists(
    context: DynamoContext,
    apiKey: ApiKey,
    {consistency}: {consistency?: DynamoReadConsistency} = {},
): Promise<{
    readonly botId: BotId;
    readonly space: {
        readonly spaceId: SpaceId;
        readonly accountId: AccountId;
        readonly scope: BotTokenPayloadScope;
    } | null;
} | null> {
    const botApiKeyItem = await BotsTable.getItemIfExists(
        context,
        {partitionType: "ApiKey", sortRangeType: "Attributes", apiKey},
        {consistency},
    );
    if (!botApiKeyItem) return null;

    return {
        botId: botApiKeyItem.botId,
        space:
            botApiKeyItem.space !== null
                ? {
                      spaceId: assertExists(botApiKeyItem.spaceId),
                      accountId: botApiKeyItem.space.accountId,
                      scope: botApiKeyItem.space.scope,
                  }
                : null,
    };
}
