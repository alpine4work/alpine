import {
    FileDocumentAuthorizer,
    authorizeDocumentAccessIfPossible,
    getDocumentCommentAuthorId,
    getDocumentCommentThreadNotificationSubscribers,
    getDocumentPreview,
} from "~/server/documents/data/documents_actions.js";
import {NotificationCreateDocumentCommentEvent} from "~/server/notifications/core/notification_event.js";
import {
    InboxTable,
    initialInboxGeneration,
} from "~/server/notifications/data/internal/inbox_table.js";
import {
    InboxDocumentCommentThreadInNewCommentThreadsEntryItemKey,
    NotificationsTable,
} from "~/server/notifications/data/internal/notifications_table.js";
import {updateInboxDocumentCommentThreadEntry} from "~/server/notifications/data/internal/update_inbox_document_comment_thread_entry.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {createNotificationEventProcessor} from "~/server/notifications/data/process/internal/create_notification_event_processor.js";
import {printNotificationEventAlertContentBody} from "~/server/notifications/data/process/internal/print_notification_event_alert_content_body.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {truncateDocumentTitleForNotification} from "~/shared/notifications/truncate_document_title_for_notification.js";

export const processNotificationCreateDocumentCommentEvent = createNotificationEventProcessor<
    NotificationCreateDocumentCommentEvent,
    {}
>({
    getSubscribers: async (context, event) => {
        const {accountIds} = await getDocumentCommentThreadNotificationSubscribers(context, {
            documentId: event.documentId,
            commentThreadId: event.commentThreadId,
            isFirstComment: event.commentIndex === 0,
            consistency: "StrongWithinCache",
        });

        return {
            info: {},
            accountIds,
        };
    },
    authorizeAccess: (context, event) => {
        return authorizeDocumentAccessIfPossible(context, event.documentId, "View", {
            consistency: "StrongWithinCache",
        });
    },
    updateInboxEntry: async (context, event, {info: {}, accountId, clientRequestToken}) => {
        const isFirstComment = event.commentIndex === 0;

        // The first comment in a thread (if it doesn't contain a mention of our user)
        // is batched into a "new comments" inbox entry. This makes it easier for the
        // document owner to browse new comments.
        if (isFirstComment && !event.mentionedAccountIds.has(accountId)) {
            // Don't update a new comment threads entry for the account who authored
            // the comment.
            if (event.authorId === accountId) return null;

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
                    sortRangeType: "DocumentNewCommentThreadsEntry",
                    spaceId: event.spaceId,
                    accountId,
                    documentId: event.documentId,
                    bucketGeneration,
                },
                async (oldItem, {isInitialAttempt, addAdditionalTransactionEntry}) => {
                    // We've already added this comment thread to the inbox entry.
                    if (oldItem?.commentThreads.has(event.commentThreadId)) return "Noop";

                    const commentThreads = new Map(
                        [
                            ...(oldItem?.commentThreads ?? []),
                            [
                                event.commentThreadId,
                                {
                                    isArchived: false,
                                    authorId: event.authorId,
                                    createdTime: event.createdTime,
                                },
                            ] as const,
                            // Make sure the comment threads are in chronological order no matter
                            // what order the events are processed in.
                        ].sort(([, a], [, b]) => a.createdTime.getTime() - b.createdTime.getTime()),
                    );

                    const documentCommentThreadInNewCommentThreadsItemKey: InboxDocumentCommentThreadInNewCommentThreadsEntryItemKey =
                        {
                            partitionType: "Inbox",
                            sortRangeType: "DocumentCommentThreadInNewCommentThreadsEntry",
                            spaceId: event.spaceId,
                            accountId,
                            documentId: event.documentId,
                            commentThreadId: event.commentThreadId,
                        };

                    // Normally when processing `CreateDocumentComment` the
                    // `DocumentCommentThreadInNewCommentThreadsEntry` item doesn't exist and we
                    // need to create it. The `DocumentCommentThreadInNewCommentThreadsEntry` item
                    // only already exists during race conditions when we process events
                    // out-of-order.
                    const documentCommentThreadInNewCommentThreadsItem = isInitialAttempt
                        ? null
                        : await NotificationsTable.getItemIfExists(
                              context,
                              documentCommentThreadInNewCommentThreadsItemKey,
                          );

                    if (documentCommentThreadInNewCommentThreadsItem) {
                        // If a `DocumentCommentThreadInNewCommentThreadsEntry` item already exists for
                        // this comment thread then we noop. This may happen if we process
                        // notifications out-of-order.
                        return "Noop";
                    } else {
                        // When we add a comment thread to the new comment threads entry, create an
                        // item mapping the `DocumentCommentThreadId` back to this new comment
                        // threads entry.
                        addAdditionalTransactionEntry(
                            NotificationsTable.transactionCreateItem(
                                {
                                    ...documentCommentThreadInNewCommentThreadsItemKey,
                                    newCommentThreadsEntry: {bucketGeneration},
                                },
                                {isConditionCheckErrorRetriable: true},
                            ),
                        );
                    }

                    return {
                        isArchived: false,
                        loudNotificationCount: 0,
                        commentThreads,
                        lastAddedCommentThreadCreatedTime:
                            oldItem &&
                            oldItem.lastAddedCommentThreadCreatedTime >= event.createdTime
                                ? oldItem.lastAddedCommentThreadCreatedTime
                                : event.createdTime,
                    };
                },
                {clientRequestToken, initialInboxItemIfExists: inboxItem},
            );
        }

        return updateInboxDocumentCommentThreadEntry(
            context,
            event.authorId,
            {
                spaceId: event.spaceId,
                accountId,
                documentId: event.documentId,
                commentThreadId: event.commentThreadId,
            },
            async oldItem => {
                // When the user comments on a document comment thread we archive the
                // corresponding inbox entry. Or if the entry is already archived, we keep it
                // archived. By sending a comment the user implicitly marks their entry as done.
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

                const firstCommentAuthorId =
                    oldItem?.firstCommentAuthorId ??
                    (isFirstComment
                        ? event.authorId
                        : await getDocumentCommentAuthorId(context, {
                              documentId: event.documentId,
                              commentThreadId: event.commentThreadId,
                              commentIndex: 0,
                          }));

                return {
                    isArchived,
                    loudNotificationCount,
                    firstCommentAuthorId,
                    latestComment:
                        isArchived && latestComment.isStickyMention
                            ? {...latestComment, isStickyMention: false}
                            : latestComment,
                    latestArchivingCommentIndex:
                        isArchived && !oldItem?.isArchived
                            ? event.commentIndex
                            : (oldItem?.latestArchivingCommentIndex ?? null),
                    otherCommentAuthorId,
                    // Always set this to false when a new comment is created.
                    isFromNewCommentThread: false,
                };
            },
            {clientRequestToken},
        );
    },
    getBotWebhookEvent: (event, {accountId}) => ({
        type: "NewMessage",
        roomPath: `/documents/${event.documentId}/threads/${event.commentThreadId}`,
        index: event.commentIndex,
        authorId: event.authorId,
        createdTimeZone: event.createdTimeZone,
        wasMentioned: event.mentionedAccountIds.has(accountId) || undefined,
    }),
    getAlertContent: async (context, event, {accountId, entryItem}) => {
        assert(
            entryItem.sortRangeType === "DocumentNewCommentThreadsEntry" ||
                entryItem.sortRangeType === "DocumentCommentThreadEntry",
        );

        const [author, document, firstCommentAuthor, body] = await runAllPromises([
            getAccount(context, event.spaceId, event.authorId),
            getDocumentPreview(context, event.documentId),
            entryItem.sortRangeType === "DocumentCommentThreadEntry" &&
            entryItem.firstCommentAuthorId !== accountId &&
            entryItem.firstCommentAuthorId !== event.authorId
                ? getAccount(context, event.spaceId, entryItem.firstCommentAuthorId)
                : null,
            printNotificationEventAlertContentBody(
                context,
                FileDocumentAuthorizer.bind({
                    type: "DocumentComments",
                    documentId: event.documentId,
                }),
                event,
            ),
        ]);

        const truncatedDocumentTitle = truncateDocumentTitleForNotification(document.getTitle());

        let subtitle = "";

        switch (entryItem.sortRangeType) {
            case "DocumentNewCommentThreadsEntry": {
                if (!event.mentionedAccountIds.has(accountId)) {
                    subtitle += truncatedDocumentTitle;
                } else {
                    subtitle += `mentioned you in their thread on ${truncatedDocumentTitle}`;
                }
                break;
            }
            case "DocumentCommentThreadEntry": {
                if (!event.mentionedAccountIds.has(accountId)) {
                    subtitle += "mentioned you in ";
                } else {
                    subtitle += "in ";
                }

                if (entryItem.firstCommentAuthorId === accountId) {
                    subtitle += "your";
                } else if (entryItem.firstCommentAuthorId === event.authorId) {
                    subtitle += "their";
                } else {
                    subtitle += `${getAccountShortNameWithoutFullNameTooltip(
                        // We should have loaded `firstCommentAuthor` under the same conditions as it
                        // took to reach this branch.
                        assertExists(firstCommentAuthor).initialData,
                    )}’s`;
                }

                subtitle += ` thread on ${truncatedDocumentTitle}`;
                break;
            }
            default:
                throw exhaustive(entryItem);
        }

        return {
            title: getAccountShortNameWithoutFullNameTooltip(author.initialData),
            subtitle,
            body,
        };
    },
});
