import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {getSpaceAccountBotIdIfExists} from "~/server/spaces/get_space_account_bot_id_if_exists.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Is the space account a bot? Same as if you checked
 * `await getSpaceAccountBotIdIfExists() !== null`.
 *
 * Throws an error if the space account isn't found.
 *
 * If you called `authorizeSpaceAccess()` before this function (as a session actor
 * for the `AccountId` you're passing into this function) then we don't make any
 * database requests. The information we need os be available in cache.
 *
 * This function is strongly consistent. It makes an eventually consistent read to
 * our action cache but since whether an account is or is not a bot is an immutable
 * fact an eventually consistent read is fine.
 */
export async function isBotSpaceAccount(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<boolean> {
    const botId = await getSpaceAccountBotIdIfExists(context, spaceId, accountId);
    return botId !== null;
}
