import {authorizePostAccessIfPossible} from "~/server/forum/data/authorize_post_access.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {getPostAuthorAndChannelPreview} from "~/server/forum/data/get_post_author_and_channel_preview.js";
import {getPostNotificationSubscribers} from "~/server/forum/data/get_post_notification_subscribers.js";
import {NotificationCreatePostCommentEvent} from "~/server/notifications/core/notification_event.js";
import {updateInboxPostCommentsEntry} from "~/server/notifications/data/internal/update_inbox_post_comments_entry.js";
import {createNotificationEventProcessor} from "~/server/notifications/data/process/internal/create_notification_event_processor.js";
import {printNotificationEventAlertContentBody} from "~/server/notifications/data/process/internal/print_notification_event_alert_content_body.js";
import {getAccount} from "~/server/spaces/spaces_actions.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId} from "~/shared/id/types/id_types.js";

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
    updateInboxEntry: async (
        context,
        event,
        {info: {postCreatedTime}, accountId, clientRequestToken},
    ) => {
        return updateInboxPostCommentsEntry(
            context,
            event.authorId,
            {
                spaceId: event.spaceId,
                accountId,
                postId: event.postId,
            },
            oldItem => {
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

                // If the new comment moves our entry out of the archive, unset the post
                // content snippet.
                const isForPostContentMention =
                    oldItem?.isArchived && !isArchived
                        ? false
                        : oldItem?.isForPostContentMention ?? false;

                return {
                    isArchived,
                    loudNotificationCount,
                    postCreatedTime,
                    isForPostContentMention,
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

        return {
            title: getAccountShortNameWithoutFullNameTooltip(author.initialData),
            subtitle,
            body,
        };
    },
});
