import {ServerActionContext} from "~/server/context/server_action_context.js";
import {permissionDeniedBotError} from "~/server/helpers/permission_denied_bot_error.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {authorizeNotBotSpaceAccount, authorizeSpaceAccess} from "~/server/spaces/spaces_actions.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, PostDraftId, SpaceId} from "~/shared/id/types/id_types.js";

export async function authorizePostDraftAccess(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    draftId: PostDraftId,
): Promise<void> {
    await authorizeSpaceAccess(context, spaceId);

    // Bots can't access drafts. Bots must directly create posts.
    await authorizeNotBotSpaceAccount(context, spaceId, accountId);

    switch (context.actor.type) {
        case "System": {
            // We don't have a use case for system actions looking at drafts right now. So
            // block it.
            throw new PermissionDeniedError("System actors can’t access post drafts");
        }
        case "Session":
        case "ImpersonatedAccount": {
            if (accountId !== context.actor.getAccountId()) {
                throw new PermissionDeniedError("Can’t access drafts from other accounts");
            }
            break;
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

    // Note that we don't authorize whether the post draft actually exists or not.
    // The session actor always has access to drafts with their `accountId` in the
    // key and nothing in the draft item can change that. We don't check if the
    // draft exists for performance because it's irrelevant to whether the account
    // has access. Also since there's a race condition when create a post with a
    // `draftId` between `getPostDraftFileAttachments()` (which calls this
    // function) and DynamoDB deleting the draft item.

    // Note that we don't authorize whether you have access to
    // `draftItem.channelId`. The draft author may have had access to the provided
    // channel when they created the draft then subsequently lost access to the
    // channel. If the user has lost access to the channel then we should consider
    // `channelId` to be null.
}
