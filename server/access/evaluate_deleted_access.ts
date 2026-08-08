import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {isAccountMemberOfSpaceWithoutAuthorization} from "~/server/spaces/is_account_member_of_space.js";
import {AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Should we allow access to a deleted entity? Assumes the actor has access to the
 * entity based on the entity's access policy at the time of deletion. Use this
 * when building `evaluateEntityAccess()` style functions.
 *
 * By default this function always returns false. But if `dangerouslyAllowDeleted`
 * is set to true then we may allow accessing deleted content.
 *
 * We allow accessing deleted content when `dangerouslyAllowDeleted` is true, the
 * user had access to the content before deletion, and:
 *
 * 1. `expectedAccessLevel` is only `View`, or the actor is a system actor
 * 2. The actor is an account with access to the space (no anonymous actors)
 *
 * The flag `dangerouslyAllowDeleted` is considered "dangerous" since we generally
 * don't want to show deleted content to the user. Enabling this will return the
 * full content as normal. So the caller has to be sure they don't show deleted
 * content to the user and instead show a message like "X was deleted".
 */
export async function evaluateDeletedAccess(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    {
        spaceId,
        expectedAccessLevel,
        dangerouslyAllowDeleted,
    }: {
        spaceId: SpaceId;
        expectedAccessLevel: AccessLevel;
        dangerouslyAllowDeleted: boolean;
    },
): Promise<boolean> {
    if (!dangerouslyAllowDeleted) return false;

    if (context.actor.type === "System") return true;

    if (!hasAccessLevel("View", expectedAccessLevel)) return false;

    if (context.actor.type === "Anonymous") return false;

    return await isAccountMemberOfSpaceWithoutAuthorization(
        context,
        spaceId,
        context.actor.getPossiblyBotAccountId(),
    );
}
