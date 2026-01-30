import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeChannelAccessIfPossible} from "~/server/forum/data/authorize_channel_access.js";
import {getPostItemForAuthorization} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {ErrorBase, PermissionDeniedError} from "~/shared/error/error.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Result} from "~/shared/helpers/control/result.js";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Authorizes that the session user can access the provided post.
 * Implicitly also authorizes that the session user can access the channel the
 * post is in and the space the channel is in.
 */
export async function authorizePostAccess(
    context: ServerActionContext,
    id: PostId,
    expectedAccessLevel: "View" | "Comment" | "Edit",
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<{spaceId: SpaceId; channelId: ChannelId; channelAccessPolicy: AccessPolicy}> {
    return unwrapResult(
        await authorizePostAccessIfPossible(context, id, expectedAccessLevel, options),
    );
}

/**
 * Authorizes that the session user can access the provided post.
 * Implicitly also authorizes that the session user can access the channel the
 * post is in and the space the channel is in.
 *
 * Returns a result if there's an authorization failure instead of throwing.
 */
export async function authorizePostAccessIfPossible(
    context: ServerActionContext,
    id: PostId,
    expectedAccessLevel: "View" | "Comment" | "Edit",
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<
    Result<{spaceId: SpaceId; channelId: ChannelId; channelAccessPolicy: AccessPolicy}, ErrorBase>
> {
    const postItem = await getPostItemForAuthorization(context, id, options);

    const result = await authorizeChannelAccessIfPossible(
        context,
        postItem.channelId,
        expectedAccessLevel,
        options,
    );
    if (!result.ok) return result;

    switch (expectedAccessLevel) {
        case "View":
        case "Comment": {
            // If you can view/comment the channel, you can view/comment the post.
            break;
        }
        case "Edit": {
            switch (context.actor.type) {
                case "System": {
                    // System actor can edit any post.
                    break;
                }
                case "Session":
                case "ImpersonatedAccount":
                case "Bot": {
                    if (postItem.authorId !== context.actor.getPossiblyBotAccountId()) {
                        return {
                            ok: false,
                            error: new PermissionDeniedError(
                                "Account doesn\u2019t have edit access to post",
                            ),
                        };
                    }
                    break;
                }
                case "Anonymous": {
                    return {ok: false, error: unauthenticatedSessionError()};
                }
                default:
                    throw exhaustive(context.actor);
            }
            break;
        }
        default:
            throw exhaustive(expectedAccessLevel);
    }

    return {
        ok: true,
        value: {
            spaceId: postItem.spaceId,
            channelId: postItem.channelId,
            channelAccessPolicy: result.value.accessPolicy,
        },
    };
}
