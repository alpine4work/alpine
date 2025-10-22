import {ApnsContextModuleBase} from "~/server/apns/apns_context_module.js";
import {
    ServerImpersonatedAccountActionContext,
    ServerSystemActionContext,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {hashMd5} from "~/server/helpers/node/hash_md5.js";
import {NotificationEvent} from "~/server/notifications/core/notification_event.js";
import {InboxEntryItem} from "~/server/notifications/data/internal/inbox_table.js";
import {
    sendPushNotificationToAccountDevices,
    shouldSendPushNotification,
} from "~/server/notifications/data/internal/send_push_notification_to_account_devices.js";
import {UpdateInboxEntryResult} from "~/server/notifications/data/process/internal/update_inbox_entry.js";
import {
    getSpaceAccountBotIdIfExists,
    impersonateAccountAsSystemContext,
    isAccountMemberOfSpace,
} from "~/server/spaces/spaces_actions.js";
import {ApiBotWebhookEvent} from "~/shared/api/types/api_specification_convenience_types.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Result} from "~/shared/helpers/control/result.js";
import {Locale, defaultLocale} from "~/shared/helpers/intl/locale.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {
    getDecodedChronologicalIdTime,
    unsafelyConstructChronologicalId,
} from "~/shared/id/chronological_id.js";
import {decodeId, decodeIdInto, idByteLength} from "~/shared/id/id.js";
import {AccountId, BotId, BotWebhookEventId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Creates a function that will process a notification event for all
 * subscribers. Some features:
 *
 * - Makes sure traces are consistent
 * - Reads subscribers with strong consistency so we don't miss new subscribers
 * - Implements notification fan-out
 *
 * This creates a processing function that's (mostly) idempotent as long as
 * `updateInboxEntry` is idempotent. We're mostly idempotent since
 * `getSubscribers` may return different `AccountId`s on each call. However,
 * we find that acceptable. If it returns a new `AccountId` on a second call
 * then we'll update that `AccountId`'s inbox which seems harmless. If it stops
 * returning an `AccountId` on a second call we already update that
 * `AccountId`'s inbox which is fine.
 */
export function createNotificationEventProcessor<Event extends NotificationEvent, Info>({
    getSubscribers,
    authorizeAccess,
    updateInboxEntry,
    getBotWebhookEvent,
    getAlertContent,
}: {
    /**
     * Get the accounts subscribed to notifications for this event.
     *
     * IMPORTANT: This function needs read-after-write consistency which means you
     * can't make eventually consistent reads. If reading from DynamoDB, always
     * make sure to explicitly use `Strong` consistency.
     *
     * We need read-after-write consistency since the update which caused a
     * notification event may have just itself added a subscriber.
     */
    getSubscribers: (
        context: ServerSystemActionContext,
        event: Event,
    ) => Promise<{
        info: Info;
        accountIds: Iterable<AccountId>;
    }>;

    /**
     * Authorize that the account actor has access to the notification subject.
     *
     * This is run for every subscriber returned by `getSubscribers()` that is
     * a current space member before we call `updateInboxEntry()`.
     *
     * You could implement authorization yourself in `getSubscribers()` by only
     * returning `AccountId`s that have access to the notification subject.
     * We've chosen to add a required function here to force you to consider
     * authorization instead of accidentally ignoring it.
     *
     * IMPORTANT: This function needs read-after-write consistency which means you
     * can't make eventually consistent reads. If reading from DynamoDB, always
     * make sure to explicitly use `Strong` consistency.
     *
     * We need read-after-write consistency since the update which caused a
     * notification event may have just itself added a subscriber.
     */
    authorizeAccess: (
        context: ServerImpersonatedAccountActionContext,
        event: Event,
        options: {info: Info},
    ) => Promise<Result<unknown>>;

    /**
     * Update the inbox entry for each subscriber. Called in parallel.
     *
     * Make sure this function is idempotent! That way the notification processor
     * as a whole will be idempotent.
     */
    updateInboxEntry: (
        context: ServerSystemActionContext,
        event: Event,
        options: {
            info: Info;
            accountId: AccountId;
        },
    ) => Promise<UpdateInboxEntryResult | null>;

    /**
     * If we have a subscriber that's a bot then instead of updating the bot's
     * inbox entry, we'll send the bot a webhook request. If you want to send a
     * bot a webhook request in response to a notification event, then return
     * an object from this function. Otherwise return null.
     */
    getBotWebhookEvent: (
        event: Event,
        options: {info: Info; accountId: AccountId},
    ) => ApiBotWebhookEvent | null;

    /**
     * Get the content of a push notification for the action. The notification will
     * be displayed in different ways on different platforms. [iOS push
     * notifications][1] appear in a banner on the device's notification feed.
     *
     * A push notification is sent if:
     *
     * - The inbox entry was updated; and
     * - The inbox entry is not archived
     *
     * The alert will be delivered silently unless `loudNotificationCount` changed.
     * In which case the alert will be delivered with high priority and a sound.
     *
     * # Style guide
     *
     * A brief style guide for writing notifications:
     *
     * - `title`: The full name of the actor sending this notification.
     *
     * - `subtitle`: A continuation of `title` detailing critical context for the
     *   notification. The subtitle must be short and fit on a single line.
     *
     *   The user should be able to read the notification's `title` and `subtitle`
     *   as one sentence. They are rendered on two lines as operating systems
     *   truncate notification titles to one line. The subtitle is on its own line
     *   (and not combined with title) so the critical context it carries can be
     *   visible.
     *
     *   For example, a `title` of "Caleb Meredith" and a `subtitle` of "on their
     *   post in Welcome" is a good notification. We don't have space to say that
     *   "Welcome" is a channel. "on" is lower cased so the `title` and `subtitle`
     *   read like one sentence when put together.
     *
     * - `body`: The content snippet associated with this notification printed on a
     *   single line of text. `printNotificationEventAlertContentBody()` can handle
     *   this for you.
     *
     * [1]: https://developer.apple.com/design/human-interface-guidelines/notifications
     */
    getAlertContent: (
        context: ServerSystemActionContext,
        event: Event,
        options: {
            info: Info;
            accountId: AccountId;
            locale: Locale;
            entryItem: InboxEntryItem;
        },
    ) => Promise<{
        title: string;
        subtitle?: string;
        body: string;
    }>;
}): (
    context: Context<ServerSystemActionContextModules & {apns: ApnsContextModuleBase}>,
    event: Event,
    span: TracerSpan,
) => Promise<void> {
    return async (context, event, span) => {
        span.addData({
            notifications: {
                eventType: event.type,
                eventId: event.id,
            },
        });

        const {info, accountIds} = await getSubscribers(
            // This function needs read-after-write consistency! So throw an error (in
            // development) when a DynamoDB read doesn't use strong consistency to make
            // sure developers don't accidentally use eventual consistency.
            //
            // We need read-after-write consistency since the update which caused a
            // notification event may have just itself added a subscriber.
            context.dynamo.expectStrongReadConsistency(),
            event,
        );

        let decodedEventIdResult: {
            bytes: Uint8Array;
            time: number;
        } | null = null;

        function decodeEventId() {
            if (decodedEventIdResult === null) {
                const bytes = decodeId(event.id);
                const time = getDecodedChronologicalIdTime(bytes);

                decodedEventIdResult = {
                    bytes,
                    time,
                };
            }

            return decodedEventIdResult;
        }

        const options = {
            event,
            info,
            decodeEventId,
        };

        // Fan out to all subscribers.
        await runAllPromises(
            mapIterable(accountIds, async accountId => process(context, accountId, options)),
        );
    };

    async function process(
        context: Context<ServerSystemActionContextModules & {apns: ApnsContextModuleBase}>,
        accountId: AccountId,
        options: {
            event: Event;
            info: Info;
            decodeEventId: () => {bytes: Uint8Array; time: number};
        },
    ) {
        const {event, info} = options;

        // Make sure the account is a current member of the space.
        if (!(await isAccountMemberOfSpace(context, event.spaceId, accountId))) {
            return;
        }

        // If the account is a bot, we want to call the bot's webhook. Since bots don't
        // have inboxes. This shouldn't make a separate database request since
        // `isBotSpaceAccount()` reads from the caches populated by
        // `isAccountMemberOfSpace()`.
        const botId = await getSpaceAccountBotIdIfExists(context, event.spaceId, accountId);

        if (botId !== null) {
            await processForBot(context, botId, accountId, options);
            return;
        }

        // Make sure the subscriber still has access to the subject of this
        // notification.
        const result = await impersonateAccountAsSystemContext(context, accountId, context =>
            authorizeAccess(
                // We expect strong read consistency here too since we need read-after-write
                // consistency. For example, in cases where we're sending a notification right
                // after the account was granted access to the notification's subject.
                context.dynamo.expectStrongReadConsistency(),
                event,
                {info},
            ),
        );
        if (!result.ok) return;

        await context.tracer.withSpan(
            "Process notification event for account",
            async (context, span) => {
                span.addData({
                    notifications: {
                        eventType: event.type,
                        eventId: event.id,
                    },
                });
                span.addPropagatedData({context: {accountId}});

                const result = await context.tracer.withSpan("Update inbox entry", async context =>
                    updateInboxEntry(context, event, {info, accountId}),
                );
                if (!result) return;

                if (shouldSendPushNotification()) {
                    await sendPushNotificationToAccountDevices(context, {
                        accountId,
                        eventId: event.id,
                        newInboxEntryItem: result.newInboxEntryItem,
                        loudNotificationCountDifference: result.loudNotificationCountDifference,
                        getAlertContent: () =>
                            getAlertContent(context, event, {
                                info,
                                accountId,
                                // TODO(calebmer): All notifications are currently in US English. When we
                                // localize the product this should change.
                                locale: defaultLocale,
                                entryItem: result.newInboxEntryItem,
                            }),
                    });
                }
            },
        );
    }

    async function processForBot(
        context: Context<ServerSystemActionContextModules & {apns: ApnsContextModuleBase}>,
        botId: BotId,
        botAccountId: AccountId,
        {
            event,
            info,
            decodeEventId,
        }: {
            event: Event;
            info: Info;
            decodeEventId: () => {bytes: Uint8Array; time: number};
        },
    ) {
        // Don't send a webhook call for message sent by our bot.
        if (event.authorId === botAccountId) return;

        const webhookEvent = getBotWebhookEvent(event, {info, accountId: botAccountId});
        if (webhookEvent === null) return;

        await context.tracer.withSpan(
            "Process notification event for bot account",
            async (context, span) => {
                span.addData({
                    notifications: {
                        eventType: event.type,
                        eventId: event.id,
                    },
                });
                span.addPropagatedData({context: {botId, accountId: botAccountId}});

                const {bytes: originalBytes, time} = decodeEventId();

                // Ignore the first 48 bytes which are the `ChronologicalId` timestamp so we
                // just have the random bytes.
                const randomBytes = originalBytes.slice(6);

                // Combine the `BotId` bytes and random bytes together. We'll hash this to get
                // our new random bytes.
                const hashBytes = new Uint8Array(idByteLength + randomBytes.byteLength);
                decodeIdInto(botId, hashBytes, 0);
                hashBytes.set(randomBytes, idByteLength);

                const newRandomBytes = new Uint8Array(hashMd5(hashBytes.buffer));

                // The `BotWebhookEventId` is deterministically generated from the
                // `NotificationEventId`. Since if the notification job re-runs multiple times,
                // we need to make sure we're calling the bot webhook with the same
                // `BotWebhookEventId`.
                //
                // We use the same time as the `NotificationEventId` and combine the
                // `NotificationEventId`'s random bytes with the `BotId` to produce the new
                // random bytes for `BotWebhookEventId`.
                const botWebhookEventId = unsafelyConstructChronologicalId<BotWebhookEventId>(
                    time,
                    // `newRandomBytes` is a 128 bit hash. `unsafelyConstructChronologicalId()`
                    // will truncate the hash to whatever fits in the `ChronologicalId` (80 bits).
                    newRandomBytes,
                );

                await context.jobs.sendAndWait({
                    type: "CallBotWebhook",
                    spaceId: event.spaceId,
                    botId,
                    botAccountId,
                    eventId: botWebhookEventId,
                    event: webhookEvent,
                });
            },
        );
    }
}
