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
import {createNotificationEventProcessor} from "~/server/notifications/data/process/internal/create_notification_event_processor.js";
import {printNotificationEventAlertContentBody} from "~/server/notifications/data/process/internal/print_notification_event_alert_content_body.js";
import {updateInboxEntry} from "~/server/notifications/data/process/internal/update_inbox_entry.js";
import {getAccount} from "~/server/spaces/spaces_actions.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
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
    updateInboxEntry: async (context, event, {info: {}, accountId}) => {
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

            return updateInboxEntry(
                context,
                event,
                accountId,
                {
                    partitionType: "Inbox",
                    sortRangeType: "DocumentNewCommentThreadsEntry",
                    spaceId: event.spaceId,
                    accountId,
                    documentId: event.documentId,
                    bucketGeneration: inboxItem?.generation ?? initialInboxGeneration,
                },
                oldItem => {
                    const commentThreadIds = new Set([
                        ...(oldItem?.commentThreadIds ?? []),
                        event.commentThreadId,
                    ]);
                    const commentThreadAuthorIds = new Set([
                        ...(oldItem?.commentThreadAuthorIds ?? []),
                        event.authorId,
                    ]);

                    return {
                        isArchived: false,
                        loudNotificationCount: 0,
                        commentThreadIds,
                        commentThreadAuthorIds,
                        firstComment: oldItem?.firstComment ?? {
                            commentThreadId: event.commentThreadId,
                            authorId: event.authorId,
                            createdTime: event.createdTime,
                            contentSnippet: event.contentSnippet,
                        },
                        latestCommentThreadCreatedTime: event.createdTime,
                    };
                },
                {initialInboxItemIfExists: inboxItem},
            );
        }

        return updateInboxEntry(
            context,
            event,
            accountId,
            {
                partitionType: "Inbox",
                sortRangeType: "DocumentCommentThreadEntry",
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
                            : oldItem?.latestArchivingCommentIndex ?? null,
                    otherCommentAuthorId,
                };
            },
        );
    },
    getBotWebhookEvent: (event, {accountId}) => ({
        type: "NewMessage",
        roomPath: `/documents/${event.documentId}/threads/${event.commentThreadId}`,
        index: event.commentIndex,
        authorId: event.authorId,
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

        return {title: author.initialData.name, subtitle, body};
    },
});
