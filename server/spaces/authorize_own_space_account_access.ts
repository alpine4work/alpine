import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {AuthorizeSpaceAccessContext} from "~/server/spaces/authorize_space_access.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Authorizes that the provided `AccountId` is the same account as the actor. If
 * the actor is a session actor then the `AccountId` must be exactly equal to
 * authenticated session. If the actor is a system actor then the `AccountId` must
 * be a member of the system actor's space.
 */
export async function authorizeOwnSpaceAccountAccess(
    context: AuthorizeSpaceAccessContext,
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
