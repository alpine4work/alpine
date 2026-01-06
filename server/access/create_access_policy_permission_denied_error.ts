import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {isAccountMemberOfSpaceWithoutAuthorization} from "~/server/spaces/is_account_member_of_space.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {ErrorBase, PermissionDeniedError} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {createAuthorizeSpaceAccessPermissionDeniedError} from "~/shared/spaces/space_error_messages.js";

/**
 * If `evaluateAccessPolicy()` returns `false` then call this function to
 * create a nice error message. We'll figure out the best error message to
 * present to the user.
 */
export async function createAccessPolicyPermissionDeniedError(
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
        aggregateDedupeKey,
        displayMessages,
    }: {
        spaceId: SpaceId;
        expectedAccessLevel: AccessLevel;
        aggregateDedupeKey?: string;
        displayMessages: Record<AccessLevel, ErrorDisplayMessage>;
    },
): Promise<ErrorBase> {
    // Throw an unauthenticated error if this is an anonymous user instead of
    // returning false. We want to show the user the unauthenticated error display
    // message when they don't have access.
    if (context.actor.type === "Anonymous") {
        return unauthenticatedSessionError();
    } else if (context.actor.type === "System" && context.actor.getSpaceId() !== spaceId) {
        return new PermissionDeniedError("System actor doesn’t have access to space", {
            aggregateDedupeKey,
        });
    } else if (
        context.actor.type === "ImpersonatedAccount" &&
        context.actor.getSpaceId() !== spaceId
    ) {
        return new PermissionDeniedError(
            "Impersonated account actor doesn’t have access to space",
            {aggregateDedupeKey},
        );
    } else if (
        context.actor.type !== "System" &&
        !(await isAccountMemberOfSpaceWithoutAuthorization(
            context,
            spaceId,
            context.actor.getPossiblyBotAccountId(),
        ))
    ) {
        return createAuthorizeSpaceAccessPermissionDeniedError(
            spaceId,
            context.actor.getPossiblyBotAccountId(),
        );
    } else {
        return new PermissionDeniedError(
            quote`Actor doesn’t have ${expectedAccessLevel} access level`,
            {
                aggregateDedupeKey,
                displayMessage: displayMessages[expectedAccessLevel],
            },
        );
    }
}
