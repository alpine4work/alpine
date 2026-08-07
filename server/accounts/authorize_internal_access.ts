import {getAccountItemWithoutAvatar} from "~/server/accounts/internal/get_account_item.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {permissionDeniedBotError} from "~/server/helpers/permission_denied_bot_error.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {PermissionDeniedError, UnimplementedError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Authorizes the account for this request has internal access. Throws a
 * `PermissionDeniedError` if not.
 */
export async function authorizeInternalAccess(
    context: Context<DynamoContextModules & {cache: CacheContextModule; actor: ActorContextModule}>,
) {
    switch (context.actor.type) {
        case "Session": {
            const {hasInternalAccess} = await getAccountItemWithoutAvatar(
                context,
                context.actor.getAccountId(),
            );

            if (!hasInternalAccess) {
                throw new PermissionDeniedError("Account does not have internal access", {
                    displayMessage: errorDisplayMessage`Only members of our team may access internal tools.`,
                });
            }
            break;
        }
        case "System": {
            throw new PermissionDeniedError("System actor does not have internal access");
        }
        case "ImpersonatedAccount": {
            // TODO(calebmer): Implement this when we need it in the future.
            throw new UnimplementedError(
                "Impersonated account actor does not have internal access",
            );
        }
        case "Anonymous": {
            throw unauthenticatedSessionError();
        }
        case "Bot": {
            throw permissionDeniedBotError();
        }
        default:
            throw exhaustive(context.actor);
    }
}
