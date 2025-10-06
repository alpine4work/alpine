import {ServerMinimalBotActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getChannelPreviewItemForAuthorization} from "~/server/forum/data/internal/get_channel_preview_item_for_authorization.js";
import {getPostItemForAuthorization} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_actions.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {PostId} from "~/shared/id/types/id_types.js";

/**
 * Load the post's access policy for a bot scoped to the post. Used
 * when evaluating whether a bot has permissions to certain resources.
 */
export async function getPostAccessPolicyForBotScope(
    context: ServerMinimalBotActionContext,
    postId: PostId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<AccessPolicy> {
    const scope = context.actor.getScope();
    if (scope.type !== "Post" || scope.postId !== postId) {
        throw new PermissionDeniedError("Can only get access policy for the scoped post");
    }

    const postItem = await getPostItemForAuthorization(context, postId, options);
    const channelItem = await getChannelPreviewItemForAuthorization(
        context,
        postItem.channelId,
        options,
    );

    await authorizeSpaceAccess(context, channelItem.spaceId);

    return channelItem.accessPolicy;
}
