import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {WebPushContextModuleBase} from "~/server/context/web_push_context_module.js";
import {getInboxEntryItemKey} from "~/server/notifications/data/internal/get_inbox_entry_item_key.js";
import {InboxEntriesIndex, InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {clearPendingSubtleNotificationsForInbox} from "~/server/notifications/data/internal/push/clear_pending_subtle_notifications_for_inbox.js";
import {PendingSubtleNotificationStub} from "~/server/notifications/data/internal/push/pending_subtle_notification_stub.js";
import {sendWebPushNotificationToAllSubscriptions} from "~/server/notifications/data/internal/push/send_web_push_notification_to_all_subscriptions.js";
import {getAccountWebPushSubscriptionsForSpace} from "~/server/notifications/data/push/get_web_push_subscriptions_for_space.js";
import {getAccountSearchAffinityEntitiesInRange} from "~/server/search/data/table/get_search_entity_affinity_points.js";
import {
    getAccountWithoutAvatar,
    getAccountWithoutAvatarIfExists,
} from "~/server/spaces/get_account.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {Context} from "~/shared/context/context.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {printPrettySmallNumberSummary} from "~/shared/design/print_pretty_small_number_summary.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {getInboxEntryDisplayContent} from "~/shared/notifications/get_inbox_entry_display_content.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {AccountModelDataWithoutAvatar} from "~/shared/spaces/account_model.js";

/**
 * Send a single quiet push notification with the combined content of all pending quiet notifications
 * that have been queued for a given inbox. Uses affinity scores of the accounts associated with
 * the original quiet notifications to determine the content of the notification.
 */
export async function sendPendingSubtleNotificationsForInbox(
    context: Context<ServerSystemActionContextModules & {webPush: WebPushContextModuleBase}>,
    {
        accountId,
        spaceId,
        sendTime = new Date(),
    }: {accountId: AccountId; spaceId: SpaceId; sendTime?: Date},
) {
    // If you're no longer a member of the space, you should not be notified about any events
    // that have happened in that space.
    if (!(await isAccountMemberOfSpace(context, spaceId, accountId))) {
        await clearPendingSubtleNotificationsForInbox(context, {accountId, spaceId});
        return;
    }

    const webPushSubscriptions = await getAccountWebPushSubscriptionsForSpace(
        context,
        accountId,
        spaceId,
    );
    if (webPushSubscriptions.length === 0) {
        return;
    }

    const [subtleNotificationsItem, currentAccount] = await runAllPromises([
        NotificationsTable.getItemIfExists(
            context,
            {
                partitionType: "Inbox",
                sortRangeType: "PendingSubtleNotifications",
                spaceId,
                accountId,
            },
            {consistency: "Strong"},
        ),
        getAccountWithoutAvatar(context, spaceId, accountId),
    ]);

    const pendingSubtleNotifications =
        subtleNotificationsItem?.pendingSubtleNotifications ?? new Map();

    if (pendingSubtleNotifications.size === 0 || !currentAccount) {
        return;
    }

    const content = await getPendingSubtleNotificationSummaryContent({
        context,
        spaceId,
        currentAccount,
        pendingSubtleNotifications,
    });

    // If we don't have any content to send, clear out the pending quiet notifications and return
    // without sending a notification.
    if (!content) {
        await clearPendingSubtleNotificationsForInbox(context, {
            accountId: currentAccount.id,
            spaceId,
        });
        return;
    }

    await runAllPromises([
        sendWebPushNotificationToAllSubscriptions(context, {
            spaceId: spaceId,
            accountId,
            subscriptions: webPushSubscriptions,
            notificationContent: {
                title: content.title,
                body: content.body,
                // `silent` refers to whether this notification will make a noise on delivery.
                // This is different from native 'silent' push notifications where the notification
                // is used for updates and not displayed - `silent` web push notifications are always
                // displayed.
                silent: true,
                data: {
                    url: `${context.constants.edgeServiceUrl}/s/${spaceId}/inbox`,
                },
                // This ensures if we send this notification multiple times, the push service will
                // replace the previous notification with the new one.
                tag: `quiet-notification-${spaceId}-${accountId}-${sendTime.getTime()}`,
            },
            options: {
                urgency: "normal",
            },
        }),
        clearPendingSubtleNotificationsForInbox(context, {accountId, spaceId}),
    ]);
}

export async function getPendingSubtleNotificationSummaryContent({
    context,
    spaceId,
    currentAccount,
    pendingSubtleNotifications,
}: {
    context: Context<ServerSystemActionContextModules & {webPush: WebPushContextModuleBase}>;
    spaceId: SpaceId;
    currentAccount: AccountModelDataWithoutAvatar;
    pendingSubtleNotifications: ReadonlyMap<string, PendingSubtleNotificationStub>;
}): Promise<{title: string; body: string} | null> {
    if (pendingSubtleNotifications.size === 0) {
        return null;
    }

    const lexicographicallySortedReferencedNotificationAuthorIds: Array<AccountId> = Array.from(
        new Set(
            pendingSubtleNotifications.values().map(notification => notification.eventAuthorId),
        ),
    ).sort();

    const authorAffinities = await arrayFromAsyncIterable(
        await getAccountSearchAffinityEntitiesInRange(context, {
            spaceId,
            accountId: currentAccount.id,
            startAccountId: assertExists(lexicographicallySortedReferencedNotificationAuthorIds[0]),
            endAccountId: assertExists(
                lexicographicallySortedReferencedNotificationAuthorIds[
                    lexicographicallySortedReferencedNotificationAuthorIds.length - 1
                ],
            ),
        }),
    );

    const lexicographicallySortedReferencedNotificationAuthorIdsSet = new Set(
        lexicographicallySortedReferencedNotificationAuthorIds,
    );
    const sortedAuthorAffinities = authorAffinities
        .filter(item =>
            lexicographicallySortedReferencedNotificationAuthorIdsSet.has(item.accountId),
        )
        .toSorted((a, b) => b.points - a.points);

    const potentialTopAccounts = await runAllPromises([
        sortedAuthorAffinities[0]
            ? getAccountWithoutAvatarIfExists(context, spaceId, sortedAuthorAffinities[0].accountId)
            : null,
        sortedAuthorAffinities[1]
            ? getAccountWithoutAvatarIfExists(context, spaceId, sortedAuthorAffinities[1].accountId)
            : null,
    ]);

    const authorCount = lexicographicallySortedReferencedNotificationAuthorIds.length;

    let inboxEntry: InboxEntryModel | undefined;
    let authorsListString: string = `from ${printPrettySmallNumberSummary(
        Math.max(authorCount, 1),
        "person",
        {
            pluralLabel: "people",
            startOfSentenceSingularLabel: "1 person",
        },
    )}`;

    // Get the most recent inbox entry for the author with the highest affinity to display in the
    // body of the notification.
    if (sortedAuthorAffinities[0] && potentialTopAccounts[0]) {
        const topAuthor = sortedAuthorAffinities[0];
        const associatedNotifications = Array.from(
            pendingSubtleNotifications
                .values()
                .filter(notification => notification.eventAuthorId === topAuthor.accountId),
        ).sort((a, b) => b.eventTime.getTime() - a.eventTime.getTime());
        const mostRecentNotification = assertExists(associatedNotifications[0]);
        const inboxEntryItemKey = getInboxEntryItemKey({
            spaceId,
            accountId: currentAccount.id,
            key: mostRecentNotification.inboxEntryKey,
        });
        const realtimeItem = await InboxTable.getRealtimeItemIfExists(context, inboxEntryItemKey);
        inboxEntry = realtimeItem?.model;

        const topAuthorNames = potentialTopAccounts
            .filter(account => account !== null)
            .map(account => getAccountShortNameWithoutFullNameTooltip(account));

        const authorNamesWithSummary =
            authorCount > topAuthorNames.length
                ? [
                      ...topAuthorNames,
                      printPrettySmallNumberSummary(authorCount - topAuthorNames.length, "other", {
                          startOfSentenceSingularLabel: "1 other",
                      }),
                  ]
                : topAuthorNames;

        authorsListString =
            authorNamesWithSummary.length > 0
                ? `from ${joinPrettyConjunctionList(authorNamesWithSummary)}`
                : authorsListString;
    }

    // If we don't have an inbox entry for the top affinity author, get the most recent inbox entry.
    if (!inboxEntry) {
        const inboxEntryItems = await InboxEntriesIndex.realtimeQuery(context, {
            partitionKey: {
                spaceId,
                accountId: currentAccount.id,
            },
            endSortKey: {
                isArchived: false,
                generation: InboxEntriesIndex.sortKeyAttributes.generation.maxValue,
                enteredTime: InboxEntriesIndex.sortKeyAttributes.enteredTime.maxValue,
            },
            limit: 1,
        });
        inboxEntry = inboxEntryItems.items[0]?.model;
    }

    // If we don't actually have any inbox entries at all, there's no content to send.
    if (!inboxEntry) {
        return null;
    }

    const title = `${printPrettySmallNumberSummary(pendingSubtleNotifications.size, "update")} ${authorsListString}`;

    const inboxEntryDisplay = getInboxEntryDisplayContent({
        entry: inboxEntry,
        locale: defaultLocale,
        currentAccount: currentAccount,
    });
    const body = inboxEntryDisplay.summary
        .map(item => {
            if (typeof item === "string") {
                return item;
            } else {
                return getAccountShortNameWithoutFullNameTooltip(item.initialData);
            }
        })
        .join("");

    return {
        title,
        body,
    };
}
