import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {spaceAccountsCache} from "~/server/spaces/internal/space_accounts_cache.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {createAuthorizeSpaceAccessPermissionDeniedError} from "~/shared/spaces/space_error_messages.js";

/**
 * Is the space account a bot? If so what's the `BotId`?
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
export async function getSpaceAccountBotIdIfExists(
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
): Promise<BotId | null> {
    const [, botId] = await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        getSpaceAccountBotIdIfExistsWithoutAuthorization(context, spaceId, accountId),
    ]);
    return botId;
}

/**
 * Same as `getSpaceAccountBotIdIfExists()` but doesn't authorize that the actor
 * has access to the space. Use only when necessary. Prefer
 * `getSpaceAccountBotIdIfExists()` wherever possible.
 *
 * This function is strongly consistent. It makes an eventually consistent read to
 * our action cache but since whether an account is or is not a bot is an immutable
 * fact an eventually consistent read is fine.
 */
export async function getSpaceAccountBotIdIfExistsWithoutAuthorization(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<BotId | null> {
    // Check if all accounts in the space are cached...
    const accountsCacheData =
        await spaceAccountsCache.dangerouslyGetDataIfExistsWithoutLoadingOrAuthorizing(
            context,
            spaceId,
        );

    const accountFromCache = accountsCacheData?.accountById.get(accountId);
    if (accountFromCache) return accountFromCache.botId ?? null;

    // Read the item with eventual consistency (and context caching). The `botId`
    // property is immutable so if we find an item then we'll know if it's a bot or
    // not. If we can't find a space account item then we try again with strong
    // consistency.
    const item1 = await getSpaceAccountItemIfExists(context, spaceId, accountId, {
        consistency: "Eventual",
        // It's ok to call this function when expecting strong read consistency. This
        // authorization check is mostly strongly consistent since we retry with strong
        // consistency below if our eventually consistent read fails.
        allowsEventualReadConsistency: true,
    });
    if (item1) return item1.botId ?? null;

    // If the item wasn't present in any cache and wasn't present when we read with
    // eventual consistency then try finding the item again one last time with strong
    // consistency.
    const item2 = await getSpaceAccountItemIfExists(context, spaceId, accountId, {
        consistency: "Strong",
    });
    if (item2) return item2.botId ?? null;

    throw createAuthorizeSpaceAccessPermissionDeniedError(spaceId, accountId);
}
