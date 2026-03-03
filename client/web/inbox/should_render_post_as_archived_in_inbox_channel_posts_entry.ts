import {PostId} from "~/shared/id/types/id_types.js";
import {
    InboxChannelPostsEntryModel,
    InboxPostCommentsEntryModel,
} from "~/shared/notifications/inbox_model.js";

/**
 * Helper function used by the route
 * `s.$spaceId.notifications.channel-posts.$channelIdAndBucketGeneration.tsx`. This
 * route renders a channel posts inbox entry. It starts by rendering the posts in
 * the inbox entry. When posts are archived from the entry they're deleted from the
 * inbox entry. The channel posts route keeps rendering the posts until a user
 * navigates away to avoid major layout shifts. But it renders the post as
 * archived. Therefore if a post isn't present in the inbox entry, we want to
 * render the post as archived.
 */
export function shouldRenderPostAsArchivedInInboxChannelPostsEntry(
    inboxEntry: InboxChannelPostsEntryModel | InboxPostCommentsEntryModel,
    postId: PostId,
) {
    if (inboxEntry.isArchived) return true;

    if (inboxEntry instanceof InboxPostCommentsEntryModel) {
        return inboxEntry.postId !== postId;
    }

    return !inboxEntry.postIds.has(postId);
}
