import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getPostItemForAuthorization} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Get the post's author without authorizing that the actor has access to the
 * post. This is dangerous since it lets you read data you shouldn't be allowed
 * to see! Though you must have access to the space the post is in.
 *
 * It's difficult to abuse this function because you at least need to know a
 * valid `PostId`. Which probably means you have access to the post through
 * some other means. So if you have a `PostId` and space access it probably
 * means you had access to the post at some previous point in time. Given the
 * post author never changes then you're reading data you could previously see
 * which while still technically a violation of our permission policies isn't
 * that bad.
 *
 * Regardless! You should have a very good reason to use this function since it
 * does technically violate our permission policies.
 */
export async function dangerouslyGetPostAuthorWithoutAuthorization(
    context: ServerActionContext,
    postId: PostId,
): Promise<AccountModel> {
    const postItem = await getPostItemForAuthorization(context, postId);
    await authorizeSpaceAccess(context, postItem.spaceId);
    return getAccount(context, postItem.spaceId, postItem.authorId);
}
