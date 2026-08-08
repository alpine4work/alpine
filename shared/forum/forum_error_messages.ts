import {AccessLevel} from "~/shared/access/access_policy.js";
import {NotFoundError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.open_source.js";
import {PostId} from "~/shared/id/types/id_types.open_source.js";

export const channelPermissionDeniedErrorDisplayMessageByExpectedAccessLevel: Record<
    AccessLevel,
    ErrorDisplayMessage
> = {
    View: errorDisplayMessage`You aren\u2019t allowed to access this channel. Ask someone with access to share it with you.`,
    Comment: errorDisplayMessage`You aren\u2019t allowed to comment in this channel. Ask someone who can share the channel to give you comment access.`,
    Edit: errorDisplayMessage`You aren\u2019t allowed to post in this channel. Ask someone who can share the channel to give you post access.`,
    Manage: errorDisplayMessage`You aren\u2019t allowed to share this channel. Ask someone who can share the channel to give you share access.`,
};

export function createChannelNotFoundError(channelId: string | undefined) {
    return new NotFoundError("Channel not found", {
        aggregateDedupeKey: channelId,
        displayMessage: errorDisplayMessage`This channel doesn\u2019t exist. Try searching \u201Cmy channels\u201D to see channels you\u2019ve posted in.`,
    });
}

export function createPostNotFoundError(postId: string | undefined) {
    return new NotFoundError("Post not found", {
        aggregateDedupeKey: postId,
        displayMessage: errorDisplayMessage`This post doesn\u2019t exist. Try searching \u201Cmy posts\u201D to see posts you\u2019ve created.`,
    });
}

export function createPostCommentNotFoundError(postId: PostId, messageIndex: number) {
    return new NotFoundError("Post comment not found", {
        aggregateDedupeKey: `${postId}-${messageIndex}`,
        displayMessage: errorDisplayMessage`This comment doesn\u2019t exist. Try searching \u201Cmy post comments\u201D to see your recent post comments.`,
    });
}
