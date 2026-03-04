import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Authorizes that the provided `AccountId` is the same account as the actor. If
 * the actor is a session actor then the `AccountId` must be exactly equal to
 * authenticated session. If the actor is a system actor then the `AccountId` must
 * be a member of the system actor's space.
 */
export async function authorizeOwnSpaceAccountAccess(
    context: Context<
        DynamoContextModules & {
            process: ProcessContextModule;
            cache: CacheContextModule;
            actor: ActorContextModule;
        }
    >,
    accountId: AccountId,
    options?: {
        displayMessage?: ErrorDisplayMessage;
    },
) {
    switch (context.actor.type) {
        case "System": {
            // System actors can access any account in their space.
            if (!(await isAccountMemberOfSpace(context, context.actor.getSpaceId(), accountId))) {
                throw new PermissionDeniedError(
                    "Can\u2019t access account that\u2019s not in the system actor\u2019s space",
                    options,
                );
            }
            break;
        }
        case "Session":
        case "ImpersonatedAccount":
        case "Bot": {
            if (context.actor.getPossiblyBotAccountId() !== accountId) {
                throw new PermissionDeniedError(
                    "Can\u2019t access account that\u2019s not the actor\u2019s",
                    options,
                );
            }
            break;
        }
        case "Anonymous": {
            throw unauthenticatedSessionError();
        }
        default:
            throw exhaustive(context.actor);
    }
}
