import {getAccountTimeZoneIfExists} from "~/server/accounts/with_spaces/accounts_actions_settings.js";
import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {dynamoClientRequestTokenMaxLength} from "~/server/dynamo/core/dynamo_max_client_request_token_length.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {
    DynamoGeneralRealtimeTableSchema,
    DynamoGeneralRealtimeTransactionEntry,
} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {isDynamoIdempotentParameterMismatchError} from "~/server/dynamo/core/is_dynamo_idempotent_parameter_mismatch_error.js";
import {NotificationEvent} from "~/server/notifications/core/notification_event.js";
import {computeDigestNotificationsNextScheduledDateTimeIfEligible} from "~/server/notifications/data/digest/compute_digest_notifications_next_scheduled_date_time_if_eligible.js";
import {getInitialInboxItem} from "~/server/notifications/data/internal/get_initial_inbox_item.js";
import {loudNotificationInboxGenerationIncrement} from "~/server/notifications/data/internal/inbox_generation_increments.js";
import {
    InboxAttributesItem,
    InboxEntryItem,
    InboxEntryItemKey,
    InboxTable,
    initialInboxGeneration,
} from "~/server/notifications/data/internal/inbox_table.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/spaces_actions.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {DistributiveKeyOf} from "~/shared/helpers/types/distributive_key_of.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {defaultDigestNotificationSchedule} from "~/shared/notifications/notifications_schedule_schema.js";

export const notificationEventBeforeExecuteTransactionTestCheckpoint =
    new TestCheckpoint<AccountId>();

export type UpdateInboxEntryResult = {
    readonly newInboxEntryItem: InboxEntryItem;
    readonly loudNotificationCountDifference: number;
};

/**
 * Helper function for updating an inbox entry and the main inbox attributes
 * item along with it. Makes sure to keep everything consistent. For example,
 * updating the inbox total loud notification count when the entry loud
 * notification count updates.
 *
 * This function is idempotent if `update` is idempotent (excluding changes to
 * `isArchived` or `loudNotificationCount`). Make sure you update properties
 * (besides `isArchived` or `loudNotificationCount`) idempotently!
 *
 * This function could be idempotent regardless of how `update` is
 * implemented if we perform every write in a DynamoDB write transaction with a
 * `clientRequestToken` but as an optimization we try to avoid transactions
 * when possible which means we need `update` to be idempotent.
 */
export async function updateInboxEntry<ItemKey extends InboxEntryItemKey>(
    context: ServerSystemActionContext,
    event: NotificationEvent,
    accountId: AccountId,
    itemKey: ItemKey,
    update: (
        item: (InboxEntryItem & ItemKey) | null,
        options: {
            isInitialAttempt: boolean;
            addAdditionalTransactionEntry: (
                entry: DynamoTransactionEntry | DynamoGeneralRealtimeTransactionEntry,
            ) => void;
            updateOtherInboxEntry: <OtherItemKey extends InboxEntryItemKey>(
                otherItemKey: OtherItemKey,
                oldOtherItem: (InboxEntryItem & OtherItemKey) | null,
                newOtherItem: DistributiveOmit<
                    InboxEntryItem & OtherItemKey,
                    DistributiveKeyOf<InboxEntryItemKey> | "generation" | "enteredTime"
                >,
            ) => void;
        },
    ) => MaybePromise<
        DistributiveOmit<
            InboxEntryItem & ItemKey,
            DistributiveKeyOf<InboxEntryItemKey> | "generation" | "enteredTime"
        >
    >,
    {initialInboxItemIfExists}: {initialInboxItemIfExists?: InboxAttributesItem | null} = {},
): Promise<UpdateInboxEntryResult | null> {
    // Bots don't have an inbox. Don't allow updating inbox entries for a bot
    // account. This should be free (no database reads) since we load and cache the
    // account earlier while processing the event.
    await authorizeNotBotSpaceAccount(context, event.spaceId, accountId);

    let hasAttempted = false;

    return context.dynamo.retryTransaction(async context => {
        const isInitialAttempt = !hasAttempted;
        hasAttempted = true;

        const [oldInboxItem, oldInboxEntryItem, accountTimeZone] = await runAllPromises([
            isInitialAttempt && initialInboxItemIfExists !== undefined
                ? initialInboxItemIfExists
                : InboxTable.getItemIfExists(context, {
                      partitionType: "Account",
                      sortRangeType: "InboxAttributes",
                      spaceId: itemKey.spaceId,
                      accountId: itemKey.accountId,
                  }),
            InboxTable.getItemIfExists(context, itemKey),
            getAccountTimeZoneIfExists(context, accountId),
        ]);

        // Make sure we use a time that's always monotonically increasing compared to
        // the previous `lastEntryUpdatedTime`.
        const currentTime = oldInboxItem?.lastEntryUpdatedTime
            ? new Date(Math.max(Date.now(), oldInboxItem.lastEntryUpdatedTime.getTime() + 1))
            : new Date();

        let newInboxItem = oldInboxItem;

        const transactionEntries: Array<
            DynamoTransactionEntry | DynamoGeneralRealtimeTransactionEntry
        > = [];

        const newInboxEntryItemPartial = await update(oldInboxEntryItem, {
            isInitialAttempt,
            addAdditionalTransactionEntry: entry => {
                transactionEntries.push(entry);
            },
            updateOtherInboxEntry: (otherItemKey, oldOtherItem, newOtherItem) => {
                const result = computeUpdateInboxEntry(context, {
                    currentTime,
                    itemKey: otherItemKey,
                    accountTimeZone,
                    // Use `newInboxItem` here in case it was updated by some other
                    // `updateOtherInboxEntry` call.
                    oldInboxItem: newInboxItem,
                    oldInboxEntryItem: oldOtherItem,
                    newInboxEntryItem: newOtherItem,
                });
                if (result === null) return;

                newInboxItem = result.newInboxItem;

                if (
                    result.newInboxEntryItem &&
                    // Optimization: Don't write to the database (and so update `updateVersionLock`)
                    // if the item didn't actually update.
                    !(oldOtherItem && isDeepEqual(oldOtherItem, result.newInboxEntryItem))
                ) {
                    newInboxItem = {
                        ...(newInboxItem ??
                            getInitialInboxItem(itemKey.spaceId, itemKey.accountId)),
                        lastEntryUpdatedTime: currentTime,
                    };

                    transactionEntries.push(
                        InboxTable.transactionDirectlyUpdateItem(result.newInboxEntryItem),
                    );
                }
            },
        });

        let newInboxEntryItem: InboxEntryItem | null = null;
        {
            const result = computeUpdateInboxEntry(context, {
                currentTime,
                itemKey,
                accountTimeZone,
                // Use `newInboxItem` here in case it was updated by some other
                // `updateOtherInboxEntry` call.
                oldInboxItem: newInboxItem,
                oldInboxEntryItem,
                newInboxEntryItem: newInboxEntryItemPartial,
            });
            if (result) {
                newInboxItem = result.newInboxItem;
                newInboxEntryItem = result.newInboxEntryItem;
            }
        }

        const loudNotificationCountDifference =
            (newInboxItem?.loudNotificationCount ?? 0) - (oldInboxItem?.loudNotificationCount ?? 0);

        if (
            newInboxEntryItem &&
            // Optimization: Don't write to the database (and so update `updateVersionLock`)
            // if the item didn't actually update.
            !(oldInboxEntryItem && isDeepEqual(oldInboxEntryItem, newInboxEntryItem))
        ) {
            newInboxItem = {
                ...(newInboxItem ?? getInitialInboxItem(itemKey.spaceId, itemKey.accountId)),
                lastEntryUpdatedTime: currentTime,
            };

            transactionEntries.push(InboxTable.transactionDirectlyUpdateItem(newInboxEntryItem));
        }

        // In practice we update the inbox item every time we update an inbox
        // entry since we're updating the `lastEntryUpdatedTime` property on the inbox
        // item.
        if (
            newInboxItem &&
            // Optimization: Don't write to the database (and so update `updateVersionLock`)
            // if the item didn't actually update.
            !(oldInboxItem && isDeepEqual(oldInboxItem, newInboxItem))
        ) {
            transactionEntries.push(InboxTable.transactionDirectlyUpdateItem(newInboxItem));
        }

        await notificationEventBeforeExecuteTransactionTestCheckpoint.waitForTest(event.authorId);

        if (transactionEntries.length === 0) {
            if (!oldInboxEntryItem) return null;

            // Even though we don't actually write a new inbox item, we still want to
            // return an update result. If we return null we won't send push notifications
            // for this event!
            //
            // It's important to still send push notifications in this case. If there's a
            // sticky mention (`latestMessage.isStickyMention` is set) the inbox entry
            // won't update (it continues to show the sticky mention) but we still want to
            // send push notifications for any messages sent after the sticky mention.
            return {
                newInboxEntryItem: oldInboxEntryItem,
                loudNotificationCountDifference,
            };
        }

        const maxClientRequestTokenLengthForIds = dynamoClientRequestTokenMaxLength - 3;
        const maxClientRequestTokenEventIdLength = Math.ceil(maxClientRequestTokenLengthForIds / 2);
        const maxClientRequestTokenAccountIdLength = Math.floor(
            maxClientRequestTokenLengthForIds / 2,
        );

        // Fill the client request token with half of the event ID and half of the
        // account ID. We end up using 16 characters for `AccountId`s and 17 characters
        // for `NotificationEventId`s whereas the full length of an ID is 26
        // characters. This does increase collision chances!
        //
        // However, if we're generating IDs at the rate of 1000 per hour we'll end up
        // [needing to wait ~18 thousand years][1] for a 1% collision chance of
        // `AccountId`s and ~101 thousand years for a 1% collision chance of
        // `NotificationEventId`s. If we get a random collision that means a
        // notification won't be sent which could be pretty bad if it's an urgent
        // notification but won't leave the system in a corrupted state.
        //
        // We start the token with `i:` (`i` stands for `inbox`) to make sure we don't
        // collide with `clientRequestToken`s generated by other parts of our system
        // since `clientRequestToken`s need to be globally unique.
        //
        // [1]: https://zelark.github.io/nano-id-cc/
        const clientRequestToken = `i:${event.id.slice(
            -maxClientRequestTokenEventIdLength,
        )}-${accountId.slice(0, maxClientRequestTokenAccountIdLength)}`;

        assert(clientRequestToken.length <= dynamoClientRequestTokenMaxLength);

        try {
            await DynamoGeneralRealtimeTableSchema.executeTransaction(context, transactionEntries, {
                clientRequestToken,
            });

            if (!newInboxEntryItem) return null;

            return {
                newInboxEntryItem,
                loudNotificationCountDifference,
            };
        } catch (error) {
            // If DynamoDB has committed a transaction with this `clientRequestToken` in the
            // last 10min then we can return peacefully to make sure this function is
            // idempotent.
            if (isDynamoIdempotentParameterMismatchError(error)) return null;

            throw error;
        }
    });
}

function computeUpdateInboxEntry<ItemKey extends InboxEntryItemKey>(
    context: Context<{tracer: TracerContextModule}>,
    {
        currentTime,
        itemKey,
        accountTimeZone,
        oldInboxItem,
        oldInboxEntryItem,
        newInboxEntryItem: newInboxEntryItemPartial1,
    }: {
        currentTime: Date;
        itemKey: ItemKey;
        accountTimeZone: TimeZone | null;
        oldInboxItem: InboxAttributesItem | null;
        oldInboxEntryItem: (InboxEntryItem & ItemKey) | null;
        newInboxEntryItem: DistributiveOmit<
            InboxEntryItem & ItemKey,
            DistributiveKeyOf<InboxEntryItemKey> | "generation" | "enteredTime"
        >;
    },
) {
    assert(
        !newInboxEntryItemPartial1.isArchived ||
            newInboxEntryItemPartial1.loudNotificationCount === 0,
        "Loud notification count of archived inbox entries must be zero",
    );

    assert(!oldInboxEntryItem || oldInboxEntryItem.partitionType === itemKey.partitionType);
    assert(!oldInboxEntryItem || oldInboxEntryItem.sortRangeType === itemKey.sortRangeType);

    const loudNotificationCountDifference =
        newInboxEntryItemPartial1.loudNotificationCount -
        (oldInboxEntryItem?.loudNotificationCount ?? 0);

    const inboxGeneration = oldInboxItem?.generation ?? initialInboxGeneration;

    const newInboxEntryItemPartial2 = {
        ...newInboxEntryItemPartial1,
        ...itemKey,
        updateLockVersion: oldInboxEntryItem?.updateLockVersion,
    } as DistributiveOmit<Extract<InboxEntryItem, ItemKey>, "generation" | "enteredTime">;

    // If there was no inbox entry and the new inbox entry would be archived (maybe
    // a user is sending a message to a chat they created) then don't create a
    // new entry.
    if (!oldInboxEntryItem && newInboxEntryItemPartial2.isArchived) {
        return null;
    }

    // We don't update archived inbox entries. An archived inbox entry stays the
    // same from the moment it's archived onward. Some `update()` functions may
    // make a change (e.g. `processNotificationCreateChatMessageEvent()` always
    // updates `latestMessage`) but we ignore it.
    if (oldInboxEntryItem?.isArchived && newInboxEntryItemPartial2.isArchived) {
        return null;
    }

    // Move the entry to the top of the inbox if:
    //
    // - The entry is newly created; OR
    // - The entry is revived from the archive; OR
    // - The entry has a loud notification
    const shouldMoveToTop =
        !oldInboxEntryItem ||
        (!newInboxEntryItemPartial2.isArchived && oldInboxEntryItem.isArchived) ||
        loudNotificationCountDifference > 0;

    const newInboxEntryItem: InboxEntryItem = {
        ...newInboxEntryItemPartial2,

        generation: shouldMoveToTop
            ? // Move our entry to the higher generation of:
              //
              // - The entry's current generation
              // - The inbox's current generation plus an increment if this is a loud
              //   notification since loud notifications should appear on top
              //
              // If our entry moves to a higher generation (usually due to a loud
              // notification) then it should stay at that generation.
              Math.max(
                  ...(oldInboxEntryItem ? [oldInboxEntryItem.generation] : []),
                  inboxGeneration +
                      (loudNotificationCountDifference > 0
                          ? loudNotificationInboxGenerationIncrement
                          : 0),
              )
            : // When we archive an item it goes back to our inbox generation. That way if
            // it's unarchived it doesn't go back into the loud notification generation.
            newInboxEntryItemPartial2.isArchived && !oldInboxEntryItem.isArchived
            ? inboxGeneration
            : oldInboxEntryItem.generation,

        enteredTime: shouldMoveToTop
            ? getInboxEntryLatestUpdateTime(newInboxEntryItemPartial2)
            : // When we archive an item, it goes to the top of the archive.
            newInboxEntryItemPartial2.isArchived && !oldInboxEntryItem.isArchived
            ? currentTime
            : oldInboxEntryItem.enteredTime,
    };

    const entryCountDifference =
        (!newInboxEntryItem.isArchived ? 1 : 0) -
        (oldInboxEntryItem && !oldInboxEntryItem.isArchived ? 1 : 0);

    const oldEntryCount = oldInboxItem?.entryCount ?? 0;

    // `Math.max` to protect against in case we under-counted the number of inbox
    // entries at some point.
    const newEntryCount = Math.max(0, oldEntryCount + entryCountDifference);

    let newInboxItem: InboxAttributesItem = {
        ...oldInboxItem,
        partitionType: "Account",
        sortRangeType: "InboxAttributes",
        spaceId: itemKey.spaceId,
        accountId: itemKey.accountId,
        generation: inboxGeneration,
        loudNotificationCount:
            (oldInboxItem?.loudNotificationCount ?? 0) + loudNotificationCountDifference,
        entryCount: newEntryCount,
        lastEntryUpdatedTime: oldInboxItem?.lastEntryUpdatedTime ?? null,
        lastZeroEntryCountTime:
            newEntryCount === 0 && oldEntryCount !== 0
                ? currentTime
                : oldInboxItem?.lastZeroEntryCountTime ?? null,
        digestNotificationsOptedOutTime: oldInboxItem?.digestNotificationsOptedOutTime ?? null,
        digestNotificationsSchedule:
            oldInboxItem?.digestNotificationsSchedule ?? defaultDigestNotificationSchedule,
        digestNotificationsNextScheduledDateTime:
            oldInboxItem?.digestNotificationsNextScheduledDateTime ?? null,
        digestNotificationsLastSentTime: oldInboxItem?.digestNotificationsLastSentTime ?? null,
    };

    newInboxItem = {
        ...newInboxItem,
        digestNotificationsNextScheduledDateTime:
            computeDigestNotificationsNextScheduledDateTimeIfEligible(context, {
                currentTime,
                timeZone: accountTimeZone,
                inboxItem: newInboxItem,
                options: {lagTimeInMinutes: 60},
            }),
    };

    return {
        newInboxItem,
        newInboxEntryItem,
    };
}

function getInboxEntryLatestUpdateTime(
    entryItem: DistributiveOmit<InboxEntryItem, "isArchived" | "generation" | "enteredTime">,
): Date {
    switch (entryItem.sortRangeType) {
        case "ChatEntry":
            return entryItem.latestMessage.createdTime;
        case "PostCommentsEntry":
            return entryItem.latestComment?.createdTime ?? entryItem.postCreatedTime;
        case "ChannelPostsEntry":
            return entryItem.latestPost.createdTime;
        case "DocumentCommentThreadEntry":
            return entryItem.latestComment.createdTime;
        case "DocumentNewCommentThreadsEntry":
            return entryItem.latestCommentThreadCreatedTime;
        case "TaskEntry":
            return entryItem.latestComment.createdTime;
        default:
            throw exhaustive(entryItem);
    }
}
