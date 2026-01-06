import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {permissionDeniedBotError} from "~/server/helpers/permission_denied_bot_error.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Authorize that the provided space account isn't a bot. Throws an error if
 * either the provided space account is a bot or the space account doesn't
 * exist.
 *
 * If you called `authorizeSpaceAccess()` before this function (as a session
 * actor for the `AccountId` you're passing into this function) then we don't
 * make any database requests. The information we need os be available in
 * cache.
 */
export async function authorizeNotBotSpaceAccount(
    context: Context<{
        process: ProcessContextModule;
        actor: ActorContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
) {
    if (await isBotSpaceAccount(context, spaceId, accountId)) {
        throw permissionDeniedBotError();
    }
}
