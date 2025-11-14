import {authorizePostAccessIfPossible} from "~/server/forum/data/authorize_post_access.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {getChannelNotificationSubscribers} from "~/server/forum/data/get_channel_notification_subscribers.js";
import {getChannelPreview} from "~/server/forum/data/get_channel_preview.js";
import {NotificationCreatePostEvent} from "~/server/notifications/core/notification_event.js";
import {
    InboxTable,
    initialInboxGeneration,
} from "~/server/notifications/data/internal/inbox_table.js";
import {
    InboxPostInChannelPostsEntryItemKey,
    NotificationsTable,
} from "~/server/notifications/data/internal/notifications_table.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {createNotificationEventProcessor} from "~/server/notifications/data/process/internal/create_notification_event_processor.js";
import {printNotificationEventAlertContentBody} from "~/server/notifications/data/process/internal/print_notification_event_alert_content_body.js";
import {getAccount} from "~/server/spaces/spaces_actions.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";

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
                            isForPostContentMention: true,
                        };
                    }

                    return {
                        isArchived: false,
                        loudNotificationCount: 1,
                        postCreatedTime: event.createdTime,
                        isForPostContentMention: true,
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
                // We've already added this post to the inbox entry.
                if (oldItem?.posts.has(event.postId)) return "Noop";

                const posts = new Map([
                    [
                        event.postId,
                        {
                            isArchived: false,
                            authorId: event.authorId,
                            createdTime: event.createdTime,
                        },
                    ],
                    ...(oldItem?.posts ?? []),
                ]);

                const postInChannelPostsItemKey: InboxPostInChannelPostsEntryItemKey = {
                    partitionType: "Inbox",
                    sortRangeType: "PostInChannelPostsEntry",
                    spaceId: event.spaceId,
                    accountId,
                    postId: event.postId,
                };

                // Normally when processing `CreatePost` the `PostInChannelPostsEntry` item
                // doesn't exist and we need to create it. The `PostInChannelPostsEntry` item
                // only already exists during race conditions when we process events
                // out-of-order.
                //
                // So as an optimization, assume `PostInChannelPostsEntry` doesn't exist on the
                // initial attempt
                const postInChannelPostsItem = isInitialAttempt
                    ? null
                    : await NotificationsTable.getItemIfExists(context, postInChannelPostsItemKey);

                if (postInChannelPostsItem) {
                    // If a `PostInChannelPostsEntry` item already exists for this post then we
                    // noop. This may happen if we process notifications out-of-order.
                    return "Noop";
                } else {
                    // When we add a post to the channel posts entry, create an item mapping the
                    // `PostId` back to this channel posts entry.
                    addAdditionalTransactionEntry(
                        NotificationsTable.transactionCreateItem(
                            {
                                ...postInChannelPostsItemKey,
                                channelPostsEntry: {
                                    channelId: event.channelId,
                                    bucketGeneration,
                                },
                            },
                            {isConditionCheckErrorRetriable: true},
                        ),
                    );
                }

                return {
                    isArchived: false,
                    loudNotificationCount: 0,
                    posts,
                    lastAddedPostCreatedTime:
                        oldItem && oldItem.lastAddedPostCreatedTime >= event.createdTime
                            ? oldItem.lastAddedPostCreatedTime
                            : event.createdTime,
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
