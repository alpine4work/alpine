import {AccessLevel} from "~/shared/access/access_policy.js";
import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {ChannelId, PostId} from "~/shared/id/types/id_types.js";

export const channelPermissionDeniedErrorDisplayMessageByExpectedAccessLevel: Record<
    AccessLevel,
    ErrorDisplayMessage
> = {
    View: errorDisplayMessage`You aren’t allowed to access this channel. Ask someone with access to share it with you.`,
    Comment: errorDisplayMessage`You aren’t allowed to comment in this channel. Ask someone who can share the channel to give you comment access.`,
    Edit: errorDisplayMessage`You aren’t allowed to post in this channel. Ask someone who can share the channel to give you post access.`,
    Manage: errorDisplayMessage`You aren’t allowed to share this channel. Ask someone who can share the channel to give you share access.`,
};

export function createChannelNotFoundError(channelId: ChannelId) {
    return new NotFoundError("Channel not found", {
        aggregateDedupeKey: channelId,
        displayMessage: errorDisplayMessage`This channel doesn’t exist. Try searching “my channels” to see channels you’ve posted in.`,
    });
}

export function createPostNotFoundError(postId: PostId) {
    return new NotFoundError("Post not found", {
        aggregateDedupeKey: postId,
        displayMessage: errorDisplayMessage`This post doesn’t exist. Try searching “my posts” to see posts you’ve created.`,
    });
}
