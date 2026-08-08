import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {SessionActorContextModule} from "~/server/helpers/actor_context_module.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {getAccountIfExistsWithoutAuthorization} from "~/server/spaces/internal/get_account_if_exists_without_authorization.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {createAuthorizeSpaceAccessPermissionDeniedError} from "~/shared/spaces/space_error_messages.js";

/**
 * You're allowed to read your own account even if you don't have access to the
 * space yet. Maybe you have an `InvitePending` account state.
 */
export async function getOwnAccountIfExists(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
        actor: SessionActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<AccountModel | null> {
    const [, account] = await runAllPromises([
        authorizeOwnSpaceAccountAccess(context, accountId),

        // Optimization: Start loading the account even before authorization completes.
        getAccountIfExistsWithoutAuthorization(context, spaceId, accountId, options),
    ]);

    if (!account) return null;

    // Can only access your account in `Active` and `InvitePending` states.
    if (account.initialData.space.state.type === "Removed") {
        throw createAuthorizeSpaceAccessPermissionDeniedError(
            spaceId,
            context.actor.getPossiblyBotAccountId(),
        );
    }

    // Sanity check: session actors can't be bots. This should be enforced throughout
    // the system but we have a sanity check here just in case we slipped up somewhere.
    //
    // This isn't important for correctness! You could remove this check and there
    // would be no new bugs. This is purely a backup validation check given when
    // creating the session actor we only check whether a session item exists in
    // DynamoDB (we don't load the account and check that it's non-bot at that point).
    if (context.actor.type === "Session" && account.botId) {
        throw new InternalError("Session actors can\u2019t be bot accounts");
    }

    return account;
}
