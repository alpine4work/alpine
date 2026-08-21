import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {dangerouslyGetAllSpaceAccountsForBot} from "~/server/spaces/dangerously_get_all_space_accounts_for_bot.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {dangerouslyRemoveSpaceAccountWithoutAuthorization} from "~/server/spaces/remove_space_account.js";
import {Context} from "~/shared/context/context.js";
import {parallelProcessAsyncIterable} from "~/shared/helpers/iterable/parallel_process_async_iterable.js";
import {BotId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Removes a bot's instantiated space account from every space it belongs to. Used
 * when a bot is deleted so it stops appearing in account lists (e.g. new chat
 * suggestions and the mention menu) and can no longer be chatted with.
 *
 * Doesn't authorize the actor! Callers must authorize managing the bot first (see
 * the bot delete flow). Doesn't read `context.actor` so it may be called from an
 * actor-less context (e.g. a maintenance job).
 *
 * Idempotent: space accounts that were already removed on a previous run are
 * skipped, so it's safe for a caller to retry.
 */
export async function removeAllSpaceAccountsForBot(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    botId: BotId,
): Promise<void> {
    // These reads are eventually consistent. This runs over every space a bot belongs
    // to, so strongly consistent reads would double the cost of the whole job to buy
    // very little: a stale read either says an account is already removed (in which
    // case skipping it is correct) or says it's still a member when it was just
    // removed, in which case the write below fails and the job is retried against
    // converged data.
    //
    // There's built-in backpressure so we don't query the next page from the iterable
    // unless we have the available concurrency to process the next item.
    await parallelProcessAsyncIterable(
        dangerouslyGetAllSpaceAccountsForBot(context, botId),
        async ({spaceId, accountId}) => {
            const spaceAccountItem = await getSpaceAccountItemIfExists(context, spaceId, accountId);

            // The account was already removed (e.g. on a previous run). There's nothing left
            // to do and `dangerouslyRemoveSpaceAccountWithoutAuthorization()` would throw.
            if (!spaceAccountItem || spaceAccountItem.state.type === "Removed") return;

            await dangerouslyRemoveSpaceAccountWithoutAuthorization(context, {spaceId, accountId});
        },
    );
}
