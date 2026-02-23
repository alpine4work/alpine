import {differenceInMinutes} from "date-fns";
import {authorizeChatAccessIfPossible} from "~/server/chat/data/authorize_chat_access.js";
import {FileChatAuthorizer} from "~/server/chat/data/file_chat_authorizer.js";
import {getChatAccountIds} from "~/server/chat/data/get_chat_account_ids.js";
import {NotificationCreateChatMessageEvent} from "~/server/notifications/core/notification_event.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {createNotificationEventProcessor} from "~/server/notifications/data/process/internal/create_notification_event_processor.js";
import {printNotificationEventAlertContentBody} from "~/server/notifications/data/process/internal/print_notification_event_alert_content_body.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ApiSearchMentionTarget} from "~/shared/api/types/api_specification_convenience_types.js";
import {getFileEntityNoun} from "~/shared/files/get_file_entity_noun.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadClerical} from "~/shared/messaging/message_schema.js";
import {minMessageViewTimestampDividerElapsedMinutes} from "~/shared/notifications/min_message_view_timestamp_divider_elapsed_minutes.js";
import {
    SearchMentionEntityId,
    parseSearchMentionEntityId,
} from "~/shared/search/search_entity_id.js";

export const processNotificationCreateChatMessageEvent = createNotificationEventProcessor<
    NotificationCreateChatMessageEvent,
    {spaceId: SpaceId; accountIds: ReadonlyArray<AccountId>}
>({
    getSubscribers: async (context, event) => {
        const {spaceId, accountIds} = await getChatAccountIds(context, event.chatId, {
            consistency: "StrongWithinCache",
        });

        return {
            info: {spaceId, accountIds},
            accountIds,
        };
    },
    authorizeAccess: (context, event) => {
        return authorizeChatAccessIfPossible(context, event.chatId, {
            consistency: "StrongWithinCache",
        });
    },
    updateInboxEntry: (
        context,
        event,
        {info: {spaceId, accountIds: chatAccountIds}, accountId, clientRequestToken},
    ) => {
        return updateInboxEntry(
            context,
            event.authorId,
            {
                partitionType: "Inbox",
                sortRangeType: "ChatEntry",
                spaceId,
                accountId,
                chatId: event.chatId,
            },
            oldItem => {
                // When the user messages a chat we archive the corresponding inbox entry. Or
                // if the chat is already archived, we keep it archived. By sending a message
                // the user implicitly marks their entry as done.
                //
                // If the events were received out-of-order we keep the last archive state
                // of the entry.
                const isArchived =
                    !oldItem ||
                    (event.messageIndex > oldItem.latestMessage.index &&
                        (oldItem.latestArchivingMessageIndex === null ||
                            event.messageIndex > oldItem.latestArchivingMessageIndex))
                        ? accountId === event.authorId
                        : oldItem.isArchived;

                let isMention;
                let shouldIncrementLoudNotificationCount;
                let loudNotificationCount;
                if (isArchived) {
                    isMention = false;
                    shouldIncrementLoudNotificationCount = false;
                    loudNotificationCount = 0;
                } else {
                    isMention = event.mentionedAccountIds.has(accountId);

                    // We increment the loud notification count if:
                    //
                    // - This account was mentioned in the message
                    // - We are adding an entry for this chat to this account's inbox (either we
                    //   are creating a new one or moving it out of the inbox archive)
                    // - Enough time has passed that new messages are likely a new thought (we use
                    //   the same time period in which timestamp dividers will be inserted so the
                    //   user may also see this visually)
                    //
                    // Chat messages are attention grabbing by default (even without messages)
                    // since chat is intended to be a realtime communication medium unlike forum
                    // which is an asynchronous communication medium.
                    //
                    // However, we don't want 1 chat message to equal 1 loud notification count
                    // since then chat messages could easily overwhelm your loud notification count
                    // and make it meaningless. So instead we have approximately 1 loud
                    // notification per chat per hour.
                    //
                    // While this scheme is a little hard for users to understand, the loud
                    // notification count does not need to be precise. It needs to give a sense of
                    // scale of work involved in answering entries in the user's inbox and our bet
                    // is the work involved to resolve your inbox entries is proportional to number
                    // of entries (vs number of messages within an entry).
                    shouldIncrementLoudNotificationCount = (() => {
                        if (isMention) return true;

                        // Don't increment the loud notification count if this is a clerical message
                        // unless this clerical message also contained a mention.
                        if (event.clerical) return false;

                        if (oldItem?.isArchived) return true;
                        if (!oldItem?.lastLoudNotificationCountTime) return true;

                        return (
                            differenceInMinutes(
                                event.createdTime,
                                oldItem.lastLoudNotificationCountTime,
                            ) >= minMessageViewTimestampDividerElapsedMinutes
                        );
                    })();

                    loudNotificationCount =
                        (oldItem?.loudNotificationCount ?? 0) +
                        (shouldIncrementLoudNotificationCount ? 1 : 0);
                }

                let latestMessage: {
                    index: number;
                    authorId: AccountId;
                    createdTime: Date;
                    isStickyMention: boolean;
                    clerical?: MessageContentPayloadClerical;
                };
                let otherAccountId: AccountId | null;

                if (
                    oldItem &&
                    // Our events may arrive out-of-order. If we have an earlier message index then
                    // what's in the entry's latest message then don't bother updating the latest
                    // message.
                    (oldItem.latestMessage.index >= event.messageIndex ||
                        // Or if the latest comment was a mention then we'll leave that in place even
                        // if there are further comments added.
                        (oldItem.latestMessage.isStickyMention && !isMention && !isArchived) ||
                        // Or if the message from our event is from the same account as the inbox
                        // owner's then don't update the latest message. Leave the last message from an
                        // account other than our inbox's account in the entry.
                        accountId === event.authorId)
                ) {
                    latestMessage = oldItem.latestMessage;
                    otherAccountId = oldItem.otherAccountId;
                } else {
                    latestMessage = {
                        index: event.messageIndex,
                        authorId: event.authorId,
                        createdTime: event.createdTime,
                        isStickyMention: isMention,
                        clerical: event.clerical,
                    };

                    if (!oldItem) {
                        // If we are creating this inbox entry fresh, pick a random account in the chat
                        // that's not our inbox's account and that's not the message author as
                        // `otherAccountId`.
                        //
                        // Randomly picking an account is probably not the ideal heuristic but gives
                        // the user some diversity in other accounts they see as opposed to, say,
                        // always picking the user with the first name alphabetically.
                        const latestMessageAuthorId = latestMessage.authorId;
                        const eligibleOtherAccountIds = chatAccountIds.filter(
                            chatAccountId =>
                                chatAccountId !== latestMessageAuthorId &&
                                chatAccountId !== accountId,
                        );

                        otherAccountId =
                            eligibleOtherAccountIds.length > 0
                                ? eligibleOtherAccountIds[
                                      randomInteger(0, eligibleOtherAccountIds.length)
                                  ]!
                                : null;
                    } else {
                        // If the `latestMessage`'s author changed then move the old `latestMessage`
                        // author into `otherAccountId`. But not if the old `latestMessage` had our
                        // inbox's account as the author.
                        otherAccountId =
                            oldItem.latestMessage.authorId !== latestMessage.authorId &&
                            oldItem.latestMessage.authorId !== accountId
                                ? oldItem.latestMessage.authorId
                                : oldItem.otherAccountId;
                    }
                }

                return {
                    isArchived,
                    loudNotificationCount,
                    lastLoudNotificationCountTime: shouldIncrementLoudNotificationCount
                        ? event.createdTime
                        : (oldItem?.lastLoudNotificationCountTime ?? null),
                    latestMessage:
                        isArchived && latestMessage.isStickyMention
                            ? {...latestMessage, isStickyMention: false}
                            : latestMessage,
                    latestArchivingMessageIndex:
                        isArchived && !oldItem?.isArchived
                            ? event.messageIndex
                            : (oldItem?.latestArchivingMessageIndex ?? null),
                    otherAccountId,
                };
            },
            {clientRequestToken},
        );
    },
    getBotWebhookEvent: (event, {accountId}) => ({
        type: "NewMessage",
        room: {
            type: "Chat",
            id: event.chatId,
        },
        index: event.messageIndex,
        authorId: event.authorId,
        createdTimeZone: event.createdTimeZone,
        wasMentioned: event.mentionedAccountIds.has(accountId) || undefined,
        parent: event.parent ?? undefined,
        viewingTarget: event.currentlyViewedSearchEntityId
            ? intoApiSearchMentionTarget(event.currentlyViewedSearchEntityId)
            : undefined,
    }),
    getAlertContent: async (
        context,
        event,
        {info: {accountIds: chatAccountIds}, entryItem, locale},
    ) => {
        assert(entryItem.sortRangeType === "ChatEntry");

        const [authorAccount, otherAccount, bodyFromEventContent] = await runAllPromises([
            getAccount(context, event.spaceId, event.authorId),
            entryItem.otherAccountId && entryItem.otherAccountId !== event.authorId
                ? getAccount(context, event.spaceId, entryItem.otherAccountId)
                : null,
            printNotificationEventAlertContentBody(
                context,
                FileChatAuthorizer.bind({type: "ChatMessages", chatId: event.chatId}),
                event,
            ),
        ]);

        let title: string;
        let body = bodyFromEventContent;

        // We don't include "Mentioned you" in the subtitle even if there was a
        // mention since:
        //
        // - Subtitle is already long
        // - All chat messages are loud notifications even if there's not a mention
        let subtitle: string | undefined;

        if (chatAccountIds.length <= 2) {
            // Use the author's full name with no subtitle if it's a direct one-to-one chat.
            title = authorAccount.initialData.name;
        } else {
            subtitle = "to ";
            title = getAccountShortNameWithoutFullNameTooltip(authorAccount.initialData);

            if (chatAccountIds.length === 3 && otherAccount) {
                subtitle += "you and ";
                subtitle += getAccountShortNameWithoutFullNameTooltip(otherAccount.initialData);
            } else if (!otherAccount) {
                subtitle += "you and ";
                subtitle += printPrettyNumber(locale, chatAccountIds.length - 2, "other");
            } else {
                subtitle += "you, ";
                subtitle += getAccountShortNameWithoutFullNameTooltip(otherAccount.initialData);
                subtitle += ", and ";
                subtitle += printPrettyNumber(locale, chatAccountIds.length - 3, "other");
            }
        }

        // If this is a share notification then override the subtitle to
        // describe what happened.
        if (event.clerical?.type === "ShareNotification") {
            const entityNoun = getFileEntityNoun(event.clerical.entityType);

            // If there's no body then put the "shared with you" message in the body
            // instead of the subtitle. This looks better since the notification isn't all
            // bold text.
            if (body.length === 0) {
                body = `shared a ${entityNoun} with you`;
            } else {
                subtitle = `shared a ${entityNoun} with you`;
            }
        }

        return {title, subtitle, body};
    },
});

function intoApiSearchMentionTarget(
    searchMentionEntityId: SearchMentionEntityId,
): ApiSearchMentionTarget {
    const entityIdObject = parseSearchMentionEntityId(searchMentionEntityId);

    switch (entityIdObject.type) {
        case "Channel": {
            return {
                type: "Channel",
                id: entityIdObject.channelId,
            };
        }
        case "Document": {
            return {
                type: "Document",
                id: entityIdObject.documentId,
            };
        }
        case "Post": {
            return {
                type: "Post",
                id: entityIdObject.postId,
            };
        }
        case "Task": {
            return {
                type: "Task",
                id: entityIdObject.taskId,
            };
        }
        case "TaskCollection": {
            return {
                type: "TaskCollection",
                id: entityIdObject.collectionId,
            };
        }
        default: {
            throw exhaustive(entityIdObject);
        }
    }
}
