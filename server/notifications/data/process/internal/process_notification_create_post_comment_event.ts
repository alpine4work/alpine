import {authorizePostAccessIfPossible} from "~/server/forum/data/authorize_post_access.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {getPostAuthorAndChannelPreview} from "~/server/forum/data/get_post_author_and_channel_preview.js";
import {getPostNotificationSubscribers} from "~/server/forum/data/get_post_notification_subscribers.js";
import {NotificationCreatePostCommentEvent} from "~/server/notifications/core/notification_event.js";
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
import {createNotificationEventProcessor} from "~/server/notifications/data/process/internal/create_notification_event_processor.js";
import {printNotificationEventAlertContentBody} from "~/server/notifications/data/process/internal/print_notification_event_alert_content_body.js";
import {updateInboxEntry} from "~/server/notifications/data/process/internal/update_inbox_entry.js";
import {getAccount} from "~/server/spaces/spaces_actions.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";

export const processNotificationCreatePostCommentEvent = createNotificationEventProcessor<
    NotificationCreatePostCommentEvent,
    {postCreatedTime: Date}
>({
    getSubscribers: async (context, event) => {
        const {accountIds, postCreatedTime} = await getPostNotificationSubscribers(
            context,
            event.postId,
            {consistency: "StrongWithinCache"},
        );

        return {
            info: {postCreatedTime},
            accountIds,
        };
    },
    authorizeAccess: (context, event) => {
        return authorizePostAccessIfPossible(context, event.postId, "View", {
            consistency: "StrongWithinCache",
        });
    },
    updateInboxEntry: async (context, event, {info: {postCreatedTime}, accountId}) => {
        // Update function for just a single `InboxPostCommentsEntryItem`.
        function update(
            oldItem: InboxPostCommentsEntryItem | null,
        ): Omit<
            InboxPostCommentsEntryItem,
            keyof InboxPostCommentsEntryItemKey | "generation" | "enteredTime"
        > {
            // When the user comments on a post we archive the corresponding inbox entry. Or
            // if the entry is already archived, we keep it archived. By sending a comment
            // the user implicitly marks their entry as done.
            //
            // If the events were received out-of-order we keep the last archive state
            // of the entry.
            const isArchived =
                !oldItem?.latestComment ||
                (event.commentIndex > oldItem.latestComment.index &&
                    (oldItem.latestArchivingCommentIndex === null ||
                        event.commentIndex > oldItem.latestArchivingCommentIndex))
                    ? accountId === event.authorId
                    : oldItem.isArchived;

            let isMention;
            let loudNotificationCount;
            if (isArchived) {
                isMention = false;
                loudNotificationCount = 0;
            } else {
                isMention = event.mentionedAccountIds.has(accountId);

                // We increment the loud notification count only if someone is explicitly
                // trying to get your attention by mentioning your account. Otherwise, we
                // expect users will respond to new post comments in their own time.
                const shouldIncrementLoudNotificationCount = isMention;

                loudNotificationCount =
                    (oldItem?.loudNotificationCount ?? 0) +
                    (shouldIncrementLoudNotificationCount ? 1 : 0);
            }

            let latestComment: {
                index: number;
                authorId: AccountId;
                createdTime: Date;
                contentSnippet: MessageContent;
                isStickyMention: boolean;
            };
            let otherCommentAuthorId: AccountId | null;

            if (
                oldItem?.latestComment &&
                // Our events may arrive out-of-order. If we have an earlier message index then
                // what's in the entry's latest message then don't bother updating the latest
                // message.
                (oldItem.latestComment.index >= event.commentIndex ||
                    // Or if the latest comment was a mention then we'll leave that in place even
                    // if there are further comments added.
                    (oldItem.latestComment.isStickyMention && !isMention && !isArchived) ||
                    // Or if the message from our event is from the same account as the inbox
                    // owner's then don't update the latest message. Leave the last message from an
                    // account other than our inbox's account in the entry.
                    accountId === event.authorId)
            ) {
                latestComment = oldItem.latestComment;
                otherCommentAuthorId = oldItem.otherCommentAuthorId;
            } else {
                latestComment = {
                    index: event.commentIndex,
                    authorId: event.authorId,
                    createdTime: event.createdTime,
                    contentSnippet: event.contentSnippet,
                    isStickyMention: isMention,
                };

                if (!oldItem) {
                    otherCommentAuthorId = null;
                } else {
                    // If the `latestComment`'s author changed then move the old `latestComment`
                    // author into `otherCommentAuthorId`. But not if the old `latestComment`
                    // had our inbox's account as the author.
                    otherCommentAuthorId =
                        oldItem.latestComment &&
                        oldItem.latestComment.authorId !== latestComment.authorId &&
                        oldItem.latestComment.authorId !== accountId
                            ? oldItem.latestComment.authorId
                            : oldItem.otherCommentAuthorId;
                }
            }

            // If the new comment moves our entry out of the archive, unset the post
            // comment snippet.
            const postContentSnippetIfMentioned =
                oldItem?.isArchived && !isArchived
                    ? null
                    : oldItem?.postContentSnippetIfMentioned ?? null;

            return {
                isArchived,
                loudNotificationCount,
                postCreatedTime,
                postContentSnippetIfMentioned,
                latestComment:
                    isArchived && latestComment.isStickyMention
                        ? {...latestComment, isStickyMention: false}
                        : latestComment,
                latestArchivingCommentIndex:
                    isArchived && !oldItem?.isArchived
                        ? event.commentIndex
                        : oldItem?.latestArchivingCommentIndex ?? null,
                otherCommentAuthorId,
            };
        }

        return updateInboxEntry(
            context,
            event,
            accountId,
            {
                partitionType: "Inbox",
                sortRangeType: "PostCommentsEntry",
                spaceId: event.spaceId,
                accountId,
                postId: event.postId,
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
                    spaceId: event.spaceId,
                    accountId,
                    postId: event.postId,
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
                    spaceId: event.spaceId,
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

                if (!channelPostsItem.archivedPostIds.has(event.postId)) {
                    const archivedPostIds = new Set([
                        ...channelPostsItem.archivedPostIds,
                        event.postId,
                    ]);

                    // Archive the `ChannelPostsEntry` if all posts within the `ChannelPostsEntry`
                    // have been archived.
                    const isArchived = archivedPostIds.size === channelPostsItem.postIds.size;

                    updateOtherInboxEntry(channelPostsItemKey, channelPostsItem, {
                        isArchived,
                        loudNotificationCount: !isArchived
                            ? channelPostsItem.loudNotificationCount
                            : 0,
                        postIds: channelPostsItem.postIds,
                        archivedPostIds,
                        postAuthorIds: channelPostsItem.postAuthorIds,
                        latestPost: channelPostsItem.latestPost,
                    });
                }

                return update(oldItem);
            },
        );
    },
    getBotWebhookEvent: (event, {accountId}) => ({
        type: "NewMessage",
        roomPath: `/posts/${event.postId}`,
        index: event.commentIndex,
        authorId: event.authorId,
        wasMentioned: event.mentionedAccountIds.has(accountId) || undefined,
    }),
    getAlertContent: async (context, event, {accountId}) => {
        const [author, post, body] = await runAllPromises([
            getAccount(context, event.spaceId, event.authorId),
            // This function is cached which is important since we call this function when
            // building a `InboxPostCommentsEntryModel` for realtime in the same action.
            getPostAuthorAndChannelPreview(context, event.postId),
            printNotificationEventAlertContentBody(
                context,
                FilePostAuthorizer.bind({type: "PostComments", postId: event.postId}),
                event,
            ),
        ]);

        let subtitle = "";

        if (!event.mentionedAccountIds.has(accountId)) {
            subtitle += "on ";
        } else {
            subtitle += "mentioned you on ";
        }

        if (post.author.id === accountId) {
            subtitle += "your";
        } else if (post.author.id === event.authorId) {
            subtitle += "their";
        } else {
            subtitle += `${getAccountShortNameWithoutFullNameTooltip(post.author.initialData)}’s`;
        }

        subtitle += ` post in ${post.channel.name}`;

        return {title: author.initialData.name, subtitle, body};
    },
});
