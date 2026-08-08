import {ServerSystemActionContextModules} from "~/server/context/server_action_context.js";
import {SlackContextModuleBase} from "~/server/context/slack_context_module_base.js";
import {WebPushContextModuleBase} from "~/server/context/web_push_context_module.js";
import {getInboxEntryItemKey} from "~/server/notifications/data/internal/get_inbox_entry_item_key.js";
import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {NotificationsTable} from "~/server/notifications/data/internal/notifications_table.js";
import {clearPendingSubtleNotificationsForInbox} from "~/server/notifications/data/internal/push/clear_pending_subtle_notifications_for_inbox.js";
import {getAllPushNotificationTargetsWithoutAuthorization} from "~/server/notifications/data/internal/push/get_all_push_notification_targets_without_authorization.js";
import {PendingSubtleNotificationStub} from "~/server/notifications/data/internal/push/pending_subtle_notification_stub.js";
import {printInboxEntryDisplayContentLatestMessageAsText} from "~/server/notifications/data/print_inbox_entry_display_content_latest_message_as_text.js";
import {getAccountSearchAffinityEntitiesInRange} from "~/server/search/data/table/get_search_entity_affinity_points.js";
import {
    getAccountWithoutAvatar,
    getAccountWithoutAvatarIfExists,
} from "~/server/spaces/get_account.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {Context} from "~/shared/context/context.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.open_source.js";
import {printPrettySmallNumberSummary} from "~/shared/design/print_pretty_small_number_summary.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.open_source.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {parallelProcessAsyncIterable} from "~/shared/helpers/iterable/parallel_process_async_iterable.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {getInboxEntryDisplayContent} from "~/shared/notifications/get_inbox_entry_display_content.js";
import {InboxEntryModel, getInboxEntryKeyPath} from "~/shared/notifications/inbox_model.js";
import {printInboxEntryDisplayContentTitleAsText} from "~/shared/notifications/print_inbox_entry_display_content_title_as_text.js";
import {AccountModelDataWithoutAvatar} from "~/shared/spaces/account_model.js";

/**
 * Send a single subtle push notification with the combined content of all pending
 * subtle notifications that have been queued for a given inbox. Uses affinity
 * scores of the accounts associated with the original subtle notifications to
 * determine the content of the notification.
 */
export async function sendPendingSubtleNotificationsForInbox(
    context: Context<
        ServerSystemActionContextModules & {
            webPush: WebPushContextModuleBase;
            slack: SlackContextModuleBase;
        }
    >,
    {
        accountId,
        spaceId,
        sendTime = new Date(),
    }: {accountId: AccountId; spaceId: SpaceId; sendTime?: Date},
) {
    // If you're no longer a member of the space, you should not be notified about any
    // events that have happened in that space.
    if (!(await isAccountMemberOfSpace(context, spaceId, accountId))) {
        await clearPendingSubtleNotificationsForInbox(context, {accountId, spaceId});
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

    // If we don't have any content to send, clear out the pending quiet notifications
    // and return without sending a notification.
    if (!content) {
        await clearPendingSubtleNotificationsForInbox(context, {
            accountId: currentAccount.id,
            spaceId,
        });
        return;
    }

    const webPushNotificationContent = {
        title: content.title,
        body: content.body,
        // `silent` refers to whether this notification will make a noise on delivery. This
        // is different from native 'silent' push notifications where the notification is
        // used for updates and not displayed - `silent` web push notifications are always
        // displayed.
        silent: true,
        data: {
            url: `${context.constants.edgeServiceUrl}/inbox/${spaceId}`,
        },
        // This ensures if we send this notification multiple times, the push service will
        // replace the previous notification with the new one.
        tag: `subtle-notification-${spaceId}-${accountId}-${sendTime.getTime()}`,
    };

    const pushNotificationTargets = getAllPushNotificationTargetsWithoutAuthorization(context, {
        accountId,
        spaceId,
    });

    await parallelProcessAsyncIterable(pushNotificationTargets, async target => {
        switch (target.type) {
            case "SlackIntegration":
                return await context.jobs.sendAndWait({
                    type: "SendNotificationToSlackIntegration",
                    spaceId,
                    accountId,
                    workspaceId: target.workspaceId,
                    notificationContent: {
                        title: content.title,
                        body: content.body,
                        plainText: content.title,
                    },
                    entryPath: `/inbox/${spaceId}`,
                });
            case "WebPushSubscription":
                return await context.jobs.sendAndWait({
                    type: "SendWebPushNotification",
                    spaceId,
                    accountId,
                    browserId: target.browserId,
                    notificationContent: webPushNotificationContent,
                    options: {
                        urgency: "normal",
                    },
                });
            case "AppleDevice":
                return await Promise.resolve();
        }
    });

    await clearPendingSubtleNotificationsForInbox(context, {accountId, spaceId});
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

    const authorAffinityPointsByAccountId = new Map<AccountId, number>(
        authorAffinities.map(item => [item.accountId, item.points] as const),
    );

    // Authors without an affinity entity (e.g. a bot) are treated as having zero
    // affinity points so they're still eligible to be selected as the top author.
    const sortedAuthorAffinities = lexicographicallySortedReferencedNotificationAuthorIds
        .map(accountId => ({
            accountId,
            points: authorAffinityPointsByAccountId.get(accountId) ?? 0,
        }))
        .toSorted((a, b) => b.points - a.points);

    const potentialTopAccounts = await runAllPromises(
        sortedAuthorAffinities
            .slice(0, 2)
            .map(authorAffinity =>
                getAccountWithoutAvatarIfExists(context, spaceId, authorAffinity.accountId),
            ),
    );

    const authorCount = lexicographicallySortedReferencedNotificationAuthorIds.length;

    let authorsListString: string = `from ${printPrettySmallNumberSummary(
        Math.max(authorCount, 1),
        "person",
        {
            pluralLabel: "people",
            startOfSentenceSingularLabel: "1 person",
        },
    )}`;

    const topAuthorNames = potentialTopAccounts
        .filter(account => account !== null)
        .map(account => getAccountShortNameWithoutFullNameTooltip(account));

    if (topAuthorNames.length > 0) {
        const authorNamesWithSummary =
            authorCount > topAuthorNames.length
                ? [
                      ...topAuthorNames,
                      printPrettySmallNumberSummary(authorCount - topAuthorNames.length, "other", {
                          startOfSentenceSingularLabel: "1 other",
                      }),
                  ]
                : topAuthorNames;

        authorsListString = `from ${joinPrettyConjunctionList(authorNamesWithSummary)}`;
    }

    // Display the most recent inbox entry for the highest affinity author in the body
    // of the notification. If that author no longer has an inbox entry, keep trying
    // the next highest affinity author.
    let inboxEntry: InboxEntryModel | undefined;
    for (const authorAffinity of sortedAuthorAffinities) {
        const associatedNotifications = Array.from(
            pendingSubtleNotifications
                .values()
                .filter(notification => notification.eventAuthorId === authorAffinity.accountId),
        ).sort((a, b) => b.eventTime.getTime() - a.eventTime.getTime());
        const mostRecentNotification = assertExists(associatedNotifications[0]);
        const inboxEntryItemKey = getInboxEntryItemKey({
            spaceId,
            accountId: currentAccount.id,
            key: mostRecentNotification.inboxEntryKey,
        });
        const realtimeItem = await InboxTable.getRealtimeItemIfExists(context, inboxEntryItemKey);
        if (realtimeItem) {
            inboxEntry = realtimeItem.model;
            break;
        }
    }

    // If none of the authors have an inbox entry, there's no content to send.
    if (!inboxEntry) {
        return null;
    }

    // Multiple pending subtle notifications can collapse into a single inbox entry
    // (e.g. several chat messages in the same chat), so count distinct inbox entries
    // based on the key path
    const distinctInboxEntryCount = new Set(
        pendingSubtleNotifications
            .values()
            .map(notification =>
                getInboxEntryKeyPath(spaceId, notification.inboxEntryKey, "narrow"),
            ),
    ).size;

    const inboxEntryDisplay = getInboxEntryDisplayContent({
        entry: inboxEntry,
        locale: defaultLocale,
        currentAccount: currentAccount,
    });
    const inboxEntryTitleText = printInboxEntryDisplayContentTitleAsText(
        inboxEntryDisplay.title,
        account => account.initialData,
    );

    // For a single inbox entry the generic "1 update from 1 person" summary adds no
    // information, so surface the inbox entry's own title as the notification title
    // and use the latest message snippet as the body.
    if (distinctInboxEntryCount === 1) {
        return {
            title: inboxEntryTitleText,
            body:
                printInboxEntryDisplayContentLatestMessageAsText(inboxEntryDisplay, {
                    excludeAuthorWhenPresentInTitle: true,
                }) ?? "",
        };
    }

    const title = `${printPrettySmallNumberSummary(distinctInboxEntryCount, "update")} ${authorsListString}`;
    return {
        title,
        body: inboxEntryTitleText,
    };
}
