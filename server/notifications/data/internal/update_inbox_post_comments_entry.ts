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
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {omitObject} from "~/shared/helpers/object/omit_object.open_source.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.open_source.js";
import {AccountId, PostId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

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
        UpdateInboxEntryNewItem<InboxPostCommentsEntryItem, InboxPostCommentsEntryItemKey> | "Noop"
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
            if (oldItem && !oldItem.archiveChannelPostsEntryAgain) return await update(oldItem);

            let newItem = await update(oldItem);

            // Remove the `archiveChannelPostsEntryAgain` flag now that we're archiving
            // `ChannelPostsEntry` again.
            if (newItem !== "Noop" && newItem.archiveChannelPostsEntryAgain) {
                newItem = omitObject(newItem, ["archiveChannelPostsEntryAgain"]);
            }

            // If we're creating this `PostCommentsEntry` then at the same time if the post is
            // present in `ChannelPostsEntry` then we want to archive it in the
            // `ChannelPostsEntry`. So the user refers to `PostCommentsEntry` from now on for
            // this post.

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
                // Create the `PostInChannelPostsEntry` item when we commit this transaction. This
                // item existing means if a `CreatePost` event is processed later we'll
                // automatically archive the post in the channel posts entry.
                //
                // If the item already exists then we need to retry.
                addAdditionalTransactionEntry(
                    NotificationsTable.transactionCreateItem(
                        {...postInChannelPostsItemKey, channelPostsEntry: null},
                        {isConditionCheckErrorRetriable: true},
                    ),
                );

                return newItem;
            }

            // If `channelPostsEntry` is null that means the item was created by
            // `updateInboxPostCommentsEntry()`. Any `CreatePost` events after
            // `postInChannelPostsItem` is created automatically archive the new post.
            if (!postInChannelPostsItem.channelPostsEntry) return newItem;

            const channelPostsItemKey: InboxChannelPostsEntryItemKey = {
                partitionType: "Inbox",
                sortRangeType: "ChannelPostsEntry",
                spaceId,
                accountId,
                channelId: postInChannelPostsItem.channelPostsEntry.channelId,
                bucketGeneration: postInChannelPostsItem.channelPostsEntry.bucketGeneration,
            };

            // Item might not exist if we're running this job multiple times since the inbox
            // entry might have been deleted.
            const channelPostsItem = await InboxTable.getItemIfExists(context, channelPostsItemKey);

            if (!channelPostsItem) {
                addAdditionalTransactionEntry(
                    InboxTable.transactionDoesNotExistConditionCheck(channelPostsItemKey),
                );
                return newItem;
            }

            const post = channelPostsItem.posts.get(postId);

            // Post is already archived in `ChannelPostsEntry`.
            if (!post || post.isArchived) {
                addAdditionalTransactionEntry(
                    InboxTable.transactionUpdateLockVersionConditionCheck(
                        channelPostsItemKey,
                        channelPostsItem.updateLockVersion,
                    ),
                );
                return newItem;
            }

            const posts = new Map(channelPostsItem.posts);
            posts.set(postId, {...post, isArchived: true});

            if (iterableEvery(posts.values(), post => post.isArchived)) {
                // If all posts are now archived then delete the entire inbox entry!
                updateOtherInboxEntry(channelPostsItemKey, channelPostsItem, "Delete");
            } else {
                updateOtherInboxEntry(channelPostsItemKey, channelPostsItem, {
                    ...channelPostsItem,
                    posts,
                });
            }

            if (newItem === "Noop") {
                newItem = oldItem ?? {
                    isArchived: true,
                    loudNotificationCount: 0,
                    postCreatedTime: post.createdTime,
                    isForPostContentMention: false,
                    latestComment: null,
                    latestArchivingCommentIndex: null,
                    otherCommentAuthorId: null,
                };
            }

            // Make sure we always create an archived entry for the post when we archived the
            // post in its corresponding `ChannelPostsEntry`. So the user can unarchive the
            // post to put it back in their inbox.
            if (newItem.isArchived) {
                newItem = {
                    ...newItem,
                    isArchived: [true, {alwaysCreate: true}],
                };
            }

            return newItem;
        },
        {clientRequestToken},
    );
}
