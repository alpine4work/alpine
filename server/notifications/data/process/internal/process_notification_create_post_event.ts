import {authorizePostAccessIfPossible} from "~/server/forum/data/authorize_post_access.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {getChannelNotificationSubscribers} from "~/server/forum/data/get_channel_notification_subscribers.js";
import {getChannelPreview} from "~/server/forum/data/get_channel_preview.js";
import {NotificationCreatePostEvent} from "~/server/notifications/core/notification_event.js";
import {
    InboxPostCommentsEntryItemKey,
    InboxTable,
    initialInboxGeneration,
} from "~/server/notifications/data/internal/inbox_table.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {createNotificationEventProcessor} from "~/server/notifications/data/process/internal/create_notification_event_processor.js";
import {printNotificationEventAlertContentBody} from "~/server/notifications/data/process/internal/print_notification_event_alert_content_body.js";
import {getAccount} from "~/server/spaces/spaces_actions.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";

export const processNotificationCreatePostEvent = createNotificationEventProcessor<
    NotificationCreatePostEvent,
    {}
>({
    getSubscribers: async (context, event) => {
        const accountIds = await getChannelNotificationSubscribers(context, event.channelId, {
            consistency: "StrongWithinCache",
        });

        return {
            info: {},
            accountIds: new Set(
                concatIterables(
                    accountIds,
                    // We need to send a notification to mentioned accounts even if they're not a
                    // channel subscriber.
                    event.mentionedAccountIds,
                ),
            ),
        };
    },
    authorizeAccess: (context, event) => {
        return authorizePostAccessIfPossible(context, event.postId, "View", {
            consistency: "StrongWithinCache",
        });
    },
    updateInboxEntry: async (context, event, {info: {}, accountId, clientRequestToken}) => {
        // Don't update an entry for the account who created the post.
        if (event.authorId === accountId) return null;

        // If the account was mentioned in the post, we create a separate entry with a
        // loud notification instead of merging into one channel post summary entry.
        if (event.mentionedAccountIds.has(accountId)) {
            return updateInboxEntry(
                context,
                event.authorId,
                {
                    partitionType: "Inbox",
                    sortRangeType: "PostCommentsEntry",
                    spaceId: event.spaceId,
                    accountId,
                    postId: event.postId,
                },
                oldItem => {
                    // If we received events out-of-order a new comment event may have created this
                    // comments inbox entry. Keep old properties in this case.
                    if (oldItem) {
                        return {
                            ...oldItem,
                            loudNotificationCount:
                                oldItem.loudNotificationCount + (!oldItem.isArchived ? 1 : 0),
                            postContentSnippetIfMentioned: event.contentSnippet,
                        };
                    }

                    return {
                        isArchived: false,
                        loudNotificationCount: 1,
                        postCreatedTime: event.createdTime,
                        postContentSnippetIfMentioned: event.contentSnippet,
                        latestComment: null,
                        latestArchivingCommentIndex: null,
                        otherCommentAuthorId: null,
                    };
                },
                {clientRequestToken},
            );
        }

        const inboxItem = await InboxTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: event.spaceId,
            accountId,
        });

        const bucketGeneration = inboxItem?.generation ?? initialInboxGeneration;

        return updateInboxEntry(
            context,
            event.authorId,
            {
                partitionType: "Inbox",
                sortRangeType: "ChannelPostsEntry",
                spaceId: event.spaceId,
                accountId,
                channelId: event.channelId,
                bucketGeneration,
            },
            async (oldItem, {isInitialAttempt, addAdditionalTransactionEntry}) => {
                const postIds = new Set([event.postId, ...(oldItem?.postIds ?? [])]);
                let archivedPostIds = oldItem?.archivedPostIds ?? emptySet;
                const postAuthorIds = new Set([event.authorId, ...(oldItem?.postAuthorIds ?? [])]);

                // When we add a post to the channel posts entry, create an item mapping the
                // `PostId` back to this channel posts entry. Create-or-replace is fine, a post
                // SHOULD only ever be in one channel posts inbox entry. If notification
                // processing code works normally. However, we don't guarantee that anywhere.
                // It's possible to imagine edge cases where a `PostId` is in multiple channel
                // post entries if the `ProcessNotificationEvent` job is retried at just the
                // right time. It's not a big deal if a `PostId` is in two channel post entries
                // and this item arbitrarily points to one of them.
                if (!oldItem?.postIds.has(event.postId)) {
                    addAdditionalTransactionEntry(
                        NotificationsTable.transactionCreateOrReplaceItem({
                            partitionType: "Inbox",
                            sortRangeType: "PostInChannelPostsEntry",
                            spaceId: event.spaceId,
                            accountId,
                            postId: event.postId,
                            channelId: event.channelId,
                            bucketGeneration,
                        }),
                    );
                }

                const postCommentsItemKey: InboxPostCommentsEntryItemKey = {
                    partitionType: "Inbox",
                    sortRangeType: "PostCommentsEntry",
                    spaceId: event.spaceId,
                    accountId,
                    postId: event.postId,
                };

                // If a `PostCommentsEntry` already exists for this post then we want to
                // immediately archive the new post in `ChannelPostsEntry`. This may happen if
                // we process notifications out-of-order.
                //
                // Normally we'll create `ChannelPostsEntry` first when `PostCommentsEntry`
                // doesn't exist. So as an optimization, assume `PostCommentsEntry` doesn't
                // exist on the initial attempt
                {
                    const postCommentsItem = isInitialAttempt
                        ? null
                        : await InboxTable.getItemIfExists(context, postCommentsItemKey);

                    if (!postCommentsItem) {
                        addAdditionalTransactionEntry(
                            InboxTable.transactionDoesNotExistConditionCheck(postCommentsItemKey, {
                                isConditionCheckErrorRetriable: true,
                            }),
                        );
                    } else {
                        archivedPostIds = new Set([...archivedPostIds, event.postId]);

                        addAdditionalTransactionEntry(
                            InboxTable.transactionExistsConditionCheck(postCommentsItemKey),
                        );
                    }
                }

                return {
                    isArchived: postIds.size === archivedPostIds.size,
                    loudNotificationCount: 0,
                    postIds,
                    archivedPostIds,
                    postAuthorIds,
                    latestPost:
                        !oldItem ||
                        oldItem.latestPost.createdTime.getTime() < event.createdTime.getTime()
                            ? {
                                  postId: event.postId,
                                  authorId: event.authorId,
                                  createdTime: event.createdTime,
                                  contentSnippet: event.contentSnippet,
                              }
                            : oldItem.latestPost,
                };
            },
            {clientRequestToken, initialInboxItemIfExists: inboxItem},
        );
    },
    getBotWebhookEvent: () => {
        // TODO(calebmer, #api): Implement bot mentioned in post.
        return null;
    },
    getAlertContent: async (context, event, {accountId}) => {
        const [author, channel, body] = await runAllPromises([
            getAccount(context, event.spaceId, event.authorId),
            getChannelPreview(context, event.channelId),
            printNotificationEventAlertContentBody(
                context,
                FilePostAuthorizer.bind({type: "Post", postId: event.postId}),
                event,
            ),
        ]);

        let subtitle: string;
        if (!event.mentionedAccountIds.has(accountId)) {
            subtitle = `in ${channel.name}`;
        } else {
            subtitle = `mentioned you in ${channel.name}`;
        }

        return {
            title: author.initialData.name,
            subtitle,
            body,
        };
    },
});
