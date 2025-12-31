import {NotificationCreateTaskCommentEvent} from "~/server/notifications/core/notification_event.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {createNotificationEventProcessor} from "~/server/notifications/data/process/internal/create_notification_event_processor.js";
import {printNotificationEventAlertContentBody} from "~/server/notifications/data/process/internal/print_notification_event_alert_content_body.js";
import {getAccount} from "~/server/spaces/spaces_actions.js";
import {
    FileTaskAuthorizer,
    authorizeTaskAccessIfPossible,
    getTaskNotificationSubscribers,
    getTaskOwnerIfPossible,
} from "~/server/tasks/data/task_table.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export const processNotificationCreateTaskCommentEvent = createNotificationEventProcessor<
    NotificationCreateTaskCommentEvent,
    {}
>({
    getSubscribers: async (context, event) => {
        const {accountIds} = await getTaskNotificationSubscribers(context, event.taskId, {
            consistency: "StrongWithinCache",
        });

        return {
            info: {},
            accountIds,
        };
    },
    authorizeAccess: async (context, event) => {
        return assertExists(
            await authorizeTaskAccessIfPossible(context, event.taskId, "View", null, {
                consistency: "StrongWithinCache",
            }),
        );
    },
    updateInboxEntry: (context, event, {info: {}, accountId, clientRequestToken}) => {
        return updateInboxEntry(
            context,
            event.authorId,
            {
                partitionType: "Inbox",
                sortRangeType: "TaskEntry",
                spaceId: event.spaceId,
                accountId,
                taskId: event.taskId,
            },
            oldItem => {
                // When the user comments on a task we archive the corresponding inbox entry. Or
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

                return {
                    isArchived,
                    loudNotificationCount,
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
            {clientRequestToken},
        );
    },
    getBotWebhookEvent: (event, {accountId}) => ({
        type: "NewMessage",
        roomPath: `/tasks/${event.taskId}`,
        index: event.commentIndex,
        authorId: event.authorId,
        createdTimeZone: event.createdTimeZone,
        wasMentioned: event.mentionedAccountIds.has(accountId) || undefined,
    }),
    getAlertContent: async (context, event, {accountId}) => {
        const [author, taskOwnerResult, body] = await runAllPromises([
            getAccount(context, event.spaceId, event.authorId),
            getTaskOwnerIfPossible(context, event.taskId),
            printNotificationEventAlertContentBody(
                context,
                FileTaskAuthorizer.bind({type: "TaskComments", taskId: event.taskId}),
                event,
            ),
        ]);

        const taskOwner = unwrapResult(taskOwnerResult);

        let subtitle = "";

        if (!event.mentionedAccountIds.has(accountId)) {
            subtitle += "on ";
        } else {
            subtitle += "mentioned you on ";
        }

        if (taskOwner.id === accountId) {
            subtitle += "your";
        } else if (taskOwner.id === event.authorId) {
            subtitle += "their";
        } else {
            subtitle += `${getAccountShortNameWithoutFullNameTooltip(taskOwner.initialData)}’s`;
        }

        subtitle += ` task`;

        return {
            title: getAccountShortNameWithoutFullNameTooltip(author.initialData),
            subtitle,
            body,
        };
    },
});
