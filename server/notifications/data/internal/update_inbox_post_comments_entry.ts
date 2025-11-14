import {ServerActionContext} from "~/server/context/server_action_context.js";
import {
    InboxChannelPostsEntryItemKey,
    InboxPostCommentsEntryItem,
    InboxPostCommentsEntryItemKey,
    InboxTable,
} from "~/server/notifications/data/internal/inbox_table.js";
import {
    InboxPostInChannelPostsEntryItemKey,
    NotificationsTable,
} from "~/server/notifications/data/internal/notifications_table.js";
import {
    UpdateInboxEntryNewItem,
    updateInboxEntry,
} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {AccountId, PostId, SpaceId} from "~/shared/id/types/id_types.js";

export function updateInboxPostCommentsEntry(
    context: ServerActionContext,
    actorAccountId: AccountId,
    {
        spaceId,
        accountId,
        postId,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        postId: PostId;
    },
    update: (
        item: InboxPostCommentsEntryItem | null,
    ) => MaybePromise<
        UpdateInboxEntryNewItem<InboxPostCommentsEntryItem, InboxPostCommentsEntryItemKey>
    >,
    {clientRequestToken}: {clientRequestToken?: string} = {},
) {
    return updateInboxEntry(
        context,
        actorAccountId,
        {
            partitionType: "Inbox",
            sortRangeType: "PostCommentsEntry",
            spaceId,
            accountId,
            postId,
        },
        async (oldItem, {updateOtherInboxEntry, addAdditionalTransactionEntry}) => {
            // If we're updating an existing `PostCommentsEntry` then don't bother updating
            // `ChannelPostsEntry`.
            if (oldItem) return update(oldItem);

            // If we're creating this `PostCommentsEntry` then at the same time if the post
            // is present in `ChannelPostsEntry` then we want to archive it in the
            // `ChannelPostsEntry`. So the user refers to `PostCommentsEntry` from now on
            // for this post.

            const postInChannelPostsItemKey: InboxPostInChannelPostsEntryItemKey = {
                partitionType: "Inbox",
                sortRangeType: "PostInChannelPostsEntry",
                spaceId,
                accountId,
                postId,
            };

            const postInChannelPostsItem = await NotificationsTable.getItemIfExists(
                context,
                postInChannelPostsItemKey,
            );

            // The post isn't present in any `ChannelPostsEntry`.
            if (!postInChannelPostsItem) {
                // Make sure there's no `ChannelPostsEntry` when we commit this transaction.
                // Otherwise we need to retry.
                addAdditionalTransactionEntry(
                    NotificationsTable.transactionDoesNotExistConditionCheck(
                        postInChannelPostsItemKey,
                        {isConditionCheckErrorRetriable: true},
                    ),
                );

                return update(oldItem);
            }

            const channelPostsItemKey: InboxChannelPostsEntryItemKey = {
                partitionType: "Inbox",
                sortRangeType: "ChannelPostsEntry",
                spaceId,
                accountId,
                channelId: postInChannelPostsItem.channelId,
                bucketGeneration: postInChannelPostsItem.bucketGeneration,
            };

            // If we have a `PostInChannelPostsEntry` item then there's definitely a
            // corresponding `ChannelPostsEntry` item. First try loading the item with
            // eventual consistency (cheap) and if that doesn't work try strong
            // consistency.
            const channelPostsItem = await InboxTable.getItemWithEventualThenStrongConsistency(
                context,
                channelPostsItemKey,
            );

            if (!channelPostsItem.archivedPostIds.has(postId)) {
                const archivedPostIds = new Set([...channelPostsItem.archivedPostIds, postId]);

                // Archive the `ChannelPostsEntry` if all posts within the `ChannelPostsEntry`
                // have been archived.
                const isArchived = archivedPostIds.size === channelPostsItem.postIds.size;

                updateOtherInboxEntry(channelPostsItemKey, channelPostsItem, {
                    isArchived,
                    loudNotificationCount: !isArchived ? channelPostsItem.loudNotificationCount : 0,
                    postIds: channelPostsItem.postIds,
                    archivedPostIds,
                    postAuthorIds: channelPostsItem.postAuthorIds,
                    latestPost: channelPostsItem.latestPost,
                });
            }

            return update(oldItem);
        },
        {clientRequestToken},
    );
}
