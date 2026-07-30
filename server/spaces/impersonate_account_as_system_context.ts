import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {
    ImpersonatedAccountActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * As a system actor, impersonate any account in the system actor's space. Throws
 * an error if the provided account isn't a member of the space.
 *
 * You may only access the account's data in the system actor's space. You can't
 * use this function to read an account's data in another space. (If authorization
 * checks for impersonated accounts are implemented properly.)
 *
 * A system actor should have access to all data in a space. So impersonating an
 * account means you end up with a subset of data your system actor has access to.
 *
 * This function is useful for performing an action with the permissions of an
 * account from a system action.
 */
export async function impersonateAccountAsSystemContext<
    Modules extends {
        process: ProcessContextModule;
        actor: SystemActorContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
    },
    Value,
>(
    context: Context<Modules>,
    accountId: AccountId,
    action: (
        context: Context<
            Replace<
                Modules,
                {
                    cache: CacheContextModule;
                    batch: BatchContextModule;
                    actor: ImpersonatedAccountActorContextModule;
                }
            >
        >,
    ) => Promise<Value>,
): Promise<Value> {
    // Double check that this is a system actor.
    context.actor.authorizeSystem();

    // Make sure the account exists and its a member of our space before we can
    // impersonate it.
    if (!(await isAccountMemberOfSpace(context, context.actor.getSpaceId(), accountId))) {
        throw new PermissionDeniedError(
            "Can\u2019t impersonate account that\u2019s not a member of system actor\u2019s space",
        );
    }

    // Bot accounts can't be impersonated. Bot accounts only get access to content
    // through "scopes". When a bot is mentioned we give them a token with limited
    // access but they may have access to content that wasn't directly shared with the
    // bot. Therefore there's not much stuff a bot can do on its own so it doesn't make
    // sense to impersonate a bot.
    if (await isBotSpaceAccount(context, context.actor.getSpaceId(), accountId)) {
        throw new PermissionDeniedError("Can\u2019t impersonate bot account");
    }

    return await context.with(
        {
            cache: context.cache.forkForChangedActor(),
            batch: context.batch.forkForChangedActor(),
            actor: ImpersonatedAccountActorContextModule.dangerouslyNew(context.actor, accountId),
        },
        action,
    );
}
