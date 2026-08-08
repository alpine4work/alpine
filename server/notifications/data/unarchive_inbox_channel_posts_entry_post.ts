import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {
    InboxPostCommentsEntryItemKey,
    InboxTable,
} from "~/server/notifications/data/internal/inbox_table.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Unarchives an individual post in a channel posts inbox entry.
 */
export async function unarchiveInboxChannelPostsEntryPost(
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
        async (item, {addAdditionalTransactionEntry}) => {
            // Noop so we're idempotent in case the item was deleted.
            if (!item) return "Noop";

            const post = item.posts.get(postId);

            if (!post)
                throw new FailedPreconditionError("Post not found in channel posts inbox entry");

            // The post is already unarchived!
            if (!post.isArchived) return "Noop";

            const posts = new Map(item.posts);
            posts.set(postId, {...post, isArchived: false});

            const postCommentsEntryItemKey: InboxPostCommentsEntryItemKey = {
                partitionType: "Inbox",
                sortRangeType: "PostCommentsEntry",
                spaceId,
                accountId: context.actor.getAccountId(),
                postId,
            };

            const postCommentsEntryItem = await InboxTable.getItemWithEventualThenStrongConsistency(
                context,
                postCommentsEntryItemKey,
            );

            // Set `archiveChannelPostsEntryAgain` to true so the next time we update the
            // `PostCommentsEntry` we'll also archive the post in this `ChannelPostsEntry`
            // again. By default, `updateInboxPostCommentsEntry()` only archives
            // `ChannelPostsEntry` when creating `PostCommentsEntry`.
            addAdditionalTransactionEntry(
                InboxTable.transactionDirectlyUpdateItem(
                    postCommentsEntryItem.update({
                        archiveChannelPostsEntryAgain: true,
                    }),
                ),
            );

            return {...item, posts};
        },
    );
}
