import {ServerActionContext} from "~/server/context/server_action_context.js";
import {permissionDeniedBotError} from "~/server/helpers/permission_denied_bot_error.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {authorizeSpaceAccessIfPossible} from "~/server/spaces/authorize_space_access.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {okResult} from "~/shared/helpers/control/ok_result.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {PostDraftId} from "~/shared/id/types/id_types.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

export async function authorizePostDraftAccess(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    draftId: PostDraftId,
): Promise<void> {
    unwrapResult(await authorizePostDraftAccessIfPossible(context, spaceId, accountId, draftId));
}

export async function authorizePostDraftAccessIfPossible(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    draftId: PostDraftId,
): Promise<Result<void, Error>> {
    const spaceAccessResult = await authorizeSpaceAccessIfPossible(context, spaceId);
    if (!spaceAccessResult.ok) return spaceAccessResult;

    // Bots can't access drafts. Bots must directly create posts.
    if (await isBotSpaceAccount(context, spaceId, accountId)) {
        return {ok: false, error: permissionDeniedBotError()};
    }

    switch (context.actor.type) {
        case "System": {
            // We don't have a use case for system actions looking at drafts right now. So
            // block it.
            return {
                ok: false,
                error: new PermissionDeniedError("System actors can\u2019t access post drafts"),
            };
        }
        case "Session":
        case "ImpersonatedAccount": {
            if (accountId !== context.actor.getAccountId()) {
                return {
                    ok: false,
                    error: new PermissionDeniedError(
                        "Can\u2019t access drafts from other accounts",
                    ),
                };
            }
            break;
        }
        case "Anonymous": {
            return {ok: false, error: unauthenticatedSessionError()};
        }
        case "Bot": {
            return {ok: false, error: permissionDeniedBotError()};
        }
        default:
            throw exhaustive(context.actor);
    }

    // Note that we don't authorize whether the post draft actually exists or not. The
    // session actor always has access to drafts with their `accountId` in the key and
    // nothing in the draft item can change that. We don't check if the draft exists
    // for performance because it's irrelevant to whether the account has access. Also
    // since there's a race condition when create a post with a `draftId` between
    // `getPostDraftFileAttachments()` (which calls this function) and DynamoDB
    // deleting the draft item.

    // Note that we don't authorize whether you have access to `draftItem.channelId`.
    // The draft author may have had access to the provided channel when they created
    // the draft then subsequently lost access to the channel. If the user has lost
    // access to the channel then we should consider `channelId` to be null.
    return okResult;
}
