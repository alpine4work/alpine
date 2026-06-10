import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {
    InboxPostCommentsEntryItemKey,
    InboxTable,
} from "~/server/notifications/data/internal/inbox_table.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Archive an individual post in a channel posts inbox entry. If this is the last
 * post to be archived then we archive the entire channel posts entry.
 */
export async function archiveInboxChannelPostsEntryPost(
    context: ServerSessionActionContext,
    {
        spaceId,
        channelId,
        bucketGeneration,
        postId,
    }: {
        spaceId: SpaceId;
        channelId: ChannelId;
        bucketGeneration: number;
        postId: PostId;
    },
): Promise<void> {
    await updateInboxEntry(
        context,
        context.actor.getAccountId(),
        {
            partitionType: "Inbox",
            sortRangeType: "ChannelPostsEntry",
            spaceId,
            accountId: context.actor.getAccountId(),
            channelId,
            bucketGeneration,
        },
        async (item, {isInitialAttempt, updateOtherInboxEntry}) => {
            // Noop so we're idempotent in case the item was deleted.
            if (!item) return "Noop";

            const post = item.posts.get(postId);

            if (!post)
                throw new FailedPreconditionError("Post not found in channel posts inbox entry");

            // The post is already archived!
            if (post.isArchived) return "Noop";

            const posts = new Map(item.posts);
            posts.set(postId, {...post, isArchived: true});

            const postCommentsEntryItemKey: InboxPostCommentsEntryItemKey = {
                partitionType: "Inbox",
                sortRangeType: "PostCommentsEntry",
                spaceId,
                accountId: context.actor.getAccountId(),
                postId,
            };

            // There's only a `PostCommentsEntry` for a post in our `ChannelPostsEntry` during
            // race conditions. So for the initial attempt of this function, don't load the
            // post comments entry. If this function retries, it may be because the
            // `PostCommentsEntry` already exists and we need to update it instead.
            const postCommentsEntryItem = isInitialAttempt
                ? null
                : await InboxTable.getItemIfExists(context, postCommentsEntryItemKey);

            // When we delete the `PostId` from `posts`, we need to create a
            // `PostCommentsEntry` item if one doesn't already exist. So the user can go to the
            // "Old" section of their inbox and unarchive this post individually.
            if (!postCommentsEntryItem) {
                updateOtherInboxEntry(postCommentsEntryItemKey, postCommentsEntryItem, {
                    isArchived: [true, {alwaysCreate: true}],
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    isForPostContentMention: false,
                    latestComment: null,
                    latestArchivingCommentIndex: null,
                    otherCommentAuthorId: null,
                });
            }

            // If all posts are now archived then delete the entire inbox entry!
            if (iterableEvery(posts.values(), post => post.isArchived)) {
                return "Delete";
            }

            return {...item, posts};
        },
    );
}
