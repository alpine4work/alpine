import {getAccountTimeZoneIfExists} from "~/server/accounts/with_spaces/get_account_time_zone_if_exists.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {
    DynamoGeneralRealtimeTableDeletedItem,
    DynamoGeneralRealtimeTableSchema,
    DynamoGeneralRealtimeTransactionEntry,
} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {computeDigestNotificationsNextScheduledDateTimeIfEligible} from "~/server/notifications/data/digest/compute_digest_notifications_next_scheduled_date_time_if_eligible.js";
import {getInitialInboxItem} from "~/server/notifications/data/internal/get_initial_inbox_item.js";
import {
    loudNotificationInboxGenerationIncrement,
    unarchivedInboxOwnEntryGenerationIncrement,
} from "~/server/notifications/data/internal/inbox_generation_increments.js";
import {
    InboxAttributesItem,
    InboxEntryItem,
    InboxEntryItemKey,
    InboxTable,
} from "~/server/notifications/data/internal/inbox_table.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqualForUnknownValues} from "~/shared/helpers/control/is_deep_equal.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {DistributiveKeyOf} from "~/shared/helpers/types/distributive_key_of.js";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export const updateInboxEntryBeforeExecuteTransactionTestCheckpoint =
    new TestCheckpoint<AccountId>();
export const updateInboxEntryAfterExecuteTransactionTestCheckpoint =
    new TestCheckpoint<AccountId>();

export type UpdateInboxEntryResult = {
    readonly newInboxEntryItem: InboxEntryItem | "Delete";
    readonly loudNotificationCountDifference: number;
};

export type UpdateInboxEntryNewItem<Item extends ItemKey, ItemKey> = DistributiveOmit<
    Item,
    DistributiveKeyOf<ItemKey> | "generation" | "enteredTime" | "isArchived"
> & {
    readonly isArchived:
        | boolean
        // An array is truthy. So checking `if (newItem.isArchived)` will work whether
        // `isArchived` is a boolean or an array.
        | readonly [true, {readonly alwaysCreate?: boolean}];
};

type InboxEntryMaybeDeletedItem =
    | {
          readonly isDeleted: false;
          readonly item: DynamoItem<InboxEntryItem> | null;
      }
    | {
          readonly isDeleted: true;
          readonly item: null;
          readonly deletedItem: DynamoGeneralRealtimeTableDeletedItem;
      };

/**
 * Helper function for updating an inbox entry and the main inbox attributes item
 * along with it. Makes sure to keep everything consistent. For example, updating
 * the inbox total loud notification count when the entry loud notification count
 * updates.
 *
 * `actorAccountId` is the account whose actions are causing this inbox update.
 * It's often different from `itemKey.accountId` which is the account of the inbox
 * we're updating. Let's say Alice sends Bob a message. When the `actorAccountId`
 * in this case is "Alice" and if we're updating Bob's inbox then
 * `itemKey.accountId` will be "Bob". If Alice is archiving an entry in their own
 * inbox then Alice is both the `actorAccountId` and `itemKey.accountId` since
 * Alice is taking an action on their own inbox.
 */
export async function updateInboxEntry<ItemKey extends InboxEntryItemKey>(
    context: ServerActionContext,
    actorAccountId: AccountId,
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
                oldOtherItem: DynamoItem<InboxEntryItem & OtherItemKey> | null,
                newOtherItem:
                    | UpdateInboxEntryNewItem<InboxEntryItem & OtherItemKey, InboxEntryItemKey>
                    | "Delete",
            ) => void;
        },
    ) => MaybePromise<
        UpdateInboxEntryNewItem<InboxEntryItem & ItemKey, InboxEntryItemKey> | "Noop" | "Delete"
    >,
    {
        clientRequestToken,
        initialInboxItemIfExists,
    }: {
        clientRequestToken?: string;
        initialInboxItemIfExists?: DynamoItem<InboxAttributesItem> | null;
    } = {},
): Promise<UpdateInboxEntryResult | null> {
    await runAllPromises([
        // Make sure we're either a system actor or we're a session actor with access to
        // this account and this space.
        authorizeSpaceAccess(context, itemKey.spaceId),
        authorizeOwnSpaceAccountAccess(context, itemKey.accountId),
        authorizeOwnSpaceAccountAccess(context, actorAccountId),

        // Bots don't have an inbox. Don't allow updating inbox entries for a bot account.
        // This should be free (no database reads) since we load and cache the account
        // earlier while processing the event.
        authorizeNotBotSpaceAccount(context, itemKey.spaceId, itemKey.accountId),
    ]);

    let hasAttempted = false;

    const result = await context.dynamo.retryTransaction(async context => {
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

            InboxTable.getItemIfExists(context, itemKey).then<InboxEntryMaybeDeletedItem | null>(
                async item => {
                    if (item) return {isDeleted: false, item};

                    // If this inbox entry is deletable, then check if there's a gravestone for the
                    // inbox entry.
                    if (!InboxTable.isDeleteItemEnabled(itemKey)) return null;

                    // Most of the time if we can't find the inbox entry it's because it never existed.
                    // Wait until we retry to see if the item was deleted.
                    if (isInitialAttempt) return null;

                    const deletedItem = await InboxTable.getDeletedItemIfExists(context, itemKey);
                    if (!deletedItem) return null;

                    return {isDeleted: true, item: null, deletedItem};
                },
            ),

            getAccountTimeZoneIfExists(context, itemKey.accountId),
        ]);

        // Make sure we use a time that's always monotonically increasing compared to the
        // previous `lastEntryUpdatedTime`.
        const currentTime = oldInboxItem?.lastEntryUpdatedTime
            ? new Date(Math.max(Date.now(), oldInboxItem.lastEntryUpdatedTime.getTime() + 1))
            : new Date();

        let newInboxItem =
            oldInboxItem ??
            DynamoItem.create(getInitialInboxItem(itemKey.spaceId, itemKey.accountId));

        const transactionEntries: Array<
            DynamoTransactionEntry | DynamoGeneralRealtimeTransactionEntry
        > = [];

        const pushTransactionEntries = (
            oldInboxEntryItem: InboxEntryMaybeDeletedItem | null,
            result: ComputeUpdateInboxEntryResult,
        ) => {
            if (result === "Noop") return;

            const {newInboxEntryItem} = result;

            // Set `newInboxItem` to the updated inbox item from the result.
            newInboxItem = result.newInboxItem;

            if (newInboxEntryItem === "Delete") {
                if (!oldInboxEntryItem?.item) {
                    // We can't delete an inbox entry that doesn't exist.
                } else {
                    newInboxItem = newInboxItem.update({lastEntryUpdatedTime: currentTime});

                    transactionEntries.push(
                        InboxTable.transactionDeleteItem(oldInboxEntryItem.item),
                    );
                }
            }
            // If the old inbox entry was deleted, then undelete it.
            else if (oldInboxEntryItem?.isDeleted) {
                newInboxItem = newInboxItem.update({lastEntryUpdatedTime: currentTime});

                transactionEntries.push(
                    InboxTable.transactionUndeleteItem(
                        oldInboxEntryItem.deletedItem,
                        newInboxEntryItem,
                    ),
                );
            }
            // Optimization: Don't write to the database (and so update `updateVersionLock`) if
            // the item didn't actually update.
            else if (!isDeepEqualForUnknownValues(oldInboxEntryItem?.item, newInboxEntryItem)) {
                newInboxItem = newInboxItem.update({lastEntryUpdatedTime: currentTime});

                transactionEntries.push(
                    InboxTable.transactionDirectlyUpdateItem(newInboxEntryItem),
                );
            }
        };

        const newInboxEntryItemPartial = await update(oldInboxEntryItem?.item ?? null, {
            isInitialAttempt,
            addAdditionalTransactionEntry: entry => {
                transactionEntries.push(entry);
            },
            updateOtherInboxEntry: (otherItemKey, oldOtherItem, newOtherItem) => {
                const result = computeUpdateInboxEntry(context, {
                    currentTime,
                    actorAccountId,
                    itemKey: otherItemKey,
                    accountTimeZone,
                    // Use `newInboxItem` here in case it was updated by some other
                    // `updateOtherInboxEntry` call.
                    oldInboxItem: newInboxItem,
                    oldInboxEntryItem: oldOtherItem,
                    newInboxEntryItem: newOtherItem,
                });

                pushTransactionEntries({isDeleted: false, item: oldOtherItem}, result);
            },
        });

        const result = computeUpdateInboxEntry(context, {
            currentTime,
            actorAccountId,
            itemKey,
            accountTimeZone,
            // Use `newInboxItem` here in case it was updated by some other
            // `updateOtherInboxEntry` call.
            oldInboxItem: newInboxItem,
            oldInboxEntryItem: oldInboxEntryItem?.item ?? null,
            newInboxEntryItem: newInboxEntryItemPartial,
        });

        pushTransactionEntries(oldInboxEntryItem, result);

        const loudNotificationCountDifference =
            newInboxItem.loudNotificationCount - (oldInboxItem?.loudNotificationCount ?? 0);

        // In practice we update the inbox item every time we update an inbox entry since
        // we're updating the `lastEntryUpdatedTime` property on the inbox item.
        //
        // Optimization: Don't write to the database (and so update `updateVersionLock`) if
        // the item didn't actually update.
        if (!isDeepEqualForUnknownValues(oldInboxItem, newInboxItem)) {
            transactionEntries.push(InboxTable.transactionDirectlyUpdateItem(newInboxItem));
        }

        await updateInboxEntryBeforeExecuteTransactionTestCheckpoint.waitForTest(actorAccountId);

        if (transactionEntries.length === 0) {
            if (!oldInboxEntryItem?.item) return null;

            // Even though we don't actually write a new inbox item, we still want to return an
            // update result. If we return null we won't send push notifications for this
            // event!
            //
            // It's important to still send push notifications in this case. If there's a
            // sticky mention (`latestMessage.isStickyMention` is set) the inbox entry won't
            // update (it continues to show the sticky mention) but we still want to send push
            // notifications for any messages sent after the sticky mention.
            return {
                newInboxEntryItem: oldInboxEntryItem.item,
                loudNotificationCountDifference,
            };
        }

        await DynamoGeneralRealtimeTableSchema.executeTransaction(context, transactionEntries, {
            clientRequestToken,
        });

        if (result === "Noop") return null;

        return {
            newInboxEntryItem: result.newInboxEntryItem,
            loudNotificationCountDifference,
        };
    });

    await updateInboxEntryAfterExecuteTransactionTestCheckpoint.waitForTest(actorAccountId);

    return result;
}

type ComputeUpdateInboxEntryResult =
    | {
          newInboxItem: DynamoItem<InboxAttributesItem>;
          newInboxEntryItem: DynamoItem<InboxEntryItem> | "Delete";
      }
    | "Noop";

function computeUpdateInboxEntry<ItemKey extends InboxEntryItemKey>(
    context: Context<{tracer: TracerContextModule}>,
    {
        currentTime,
        actorAccountId,
        itemKey,
        accountTimeZone,
        oldInboxItem,
        oldInboxEntryItem,
        newInboxEntryItem: newInboxEntryItemPartial1,
    }: {
        currentTime: Date;
        actorAccountId: AccountId;
        itemKey: ItemKey;
        accountTimeZone: TimeZone | null;
        oldInboxItem: DynamoItem<InboxAttributesItem>;
        oldInboxEntryItem: DynamoItem<InboxEntryItem & ItemKey> | null;
        newInboxEntryItem:
            | UpdateInboxEntryNewItem<InboxEntryItem & ItemKey, InboxEntryItemKey>
            | "Noop"
            | "Delete";
    },
): ComputeUpdateInboxEntryResult {
    if (newInboxEntryItemPartial1 === "Noop") return "Noop";

    const inboxGeneration = oldInboxItem.generation;
    const oldEntryCount = oldInboxItem.entryCount;

    const isCountingNewEntry =
        newInboxEntryItemPartial1 !== "Delete" && !newInboxEntryItemPartial1.isArchived;

    const isCountingOldEntry = !!oldInboxEntryItem && !oldInboxEntryItem.isArchived;

    const entryCountDifference = (isCountingNewEntry ? 1 : 0) - (isCountingOldEntry ? 1 : 0);

    // `Math.max` to protect against in case we under-counted the number of inbox
    // entries at some point.
    const newEntryCount = Math.max(0, oldEntryCount + entryCountDifference);

    const newLoudNotificationCount =
        newInboxEntryItemPartial1 !== "Delete"
            ? newInboxEntryItemPartial1.loudNotificationCount
            : 0;

    const loudNotificationCountDifference =
        newLoudNotificationCount - (oldInboxEntryItem?.loudNotificationCount ?? 0);

    let newInboxItem: DynamoItem<InboxAttributesItem> = oldInboxItem.update({
        loudNotificationCount:
            (oldInboxItem?.loudNotificationCount ?? 0) + loudNotificationCountDifference,
        entryCount: newEntryCount,
        lastZeroEntryCountTime:
            newEntryCount === 0 && oldEntryCount !== 0
                ? currentTime
                : oldInboxItem.lastZeroEntryCountTime,
    });

    // Only schedule a digest notification if this inbox change is because of someone's
    // actions updating another person's inbox.
    //
    // For example, if Alice (`actorAccountId`) sends Bob (`itemKey.accountId` since
    // we're updating Bob's inbox) a message we want to schedule a notification digest
    // for Bob. However, if Alice (`actorAccountId`) archives one of her own inbox
    // entries (so `itemKey.accountId` is Alice as well) then don't schedule a
    // notification digest.
    //
    // If a user is acting on their own inbox then they've seen the current state of
    // their inbox and don't need to be notified about changes (since they made the
    // changes!).
    if (actorAccountId !== itemKey.accountId) {
        newInboxItem = newInboxItem.update({
            digestNotificationsNextScheduledDateTime:
                computeDigestNotificationsNextScheduledDateTimeIfEligible(context, {
                    currentTime,
                    timeZone: accountTimeZone,
                    inboxItem: newInboxItem,
                    options: {lagTimeInMinutes: 60},
                }),
        });
    }

    if (newInboxEntryItemPartial1 === "Delete") {
        return {newInboxItem, newInboxEntryItem: "Delete"};
    }

    assert(
        !newInboxEntryItemPartial1.isArchived ||
            newInboxEntryItemPartial1.loudNotificationCount === 0,
        "Loud notification count of archived inbox entries must be zero",
    );

    assert(!oldInboxEntryItem || oldInboxEntryItem.partitionType === itemKey.partitionType);
    assert(!oldInboxEntryItem || oldInboxEntryItem.sortRangeType === itemKey.sortRangeType);

    const newInboxEntryItemPartial2 = {
        ...newInboxEntryItemPartial1,
        isArchived: !!newInboxEntryItemPartial1.isArchived,
        ...itemKey,
        updateLockVersion: oldInboxEntryItem?.updateLockVersion,
    } as DistributiveOmit<Extract<InboxEntryItem, ItemKey>, "generation" | "enteredTime">;

    const newInboxEntryItemIsArchivedOptions = isReadonlyArray(newInboxEntryItemPartial1.isArchived)
        ? newInboxEntryItemPartial1.isArchived[1]
        : undefined;

    // If there was no inbox entry and the new inbox entry would be archived (maybe a
    // user is sending a message to a chat they created) then don't create a new entry.
    if (
        !oldInboxEntryItem &&
        newInboxEntryItemPartial2.isArchived &&
        // If `alwaysCreate` is set to true then we create an archived inbox entry even if
        // no previous entry existed.
        !newInboxEntryItemIsArchivedOptions?.alwaysCreate
    ) {
        return "Noop";
    }

    // We don't update archived inbox entries. An archived inbox entry stays the same
    // from the moment it's archived onward. Some `update()` functions may make a
    // change (e.g. `processNotificationCreateChatMessageEvent()` always updates
    // `latestMessage`) but we ignore it.
    if (oldInboxEntryItem?.isArchived && newInboxEntryItemPartial2.isArchived) {
        return "Noop";
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

    // Has the actor unarchived their own entry? This happens if the user chooses "Move
    // to new" in the UI which calls the `unarchiveInboxEntry()` RPC. If the user is
    // personally unarchiving an entry then we want to move it to the absolute top of
    // their inbox (instead of trying to intelligently place it near the top in the
    // inbox's quantum state).
    const hasActorUnarchivedOwnEntry =
        actorAccountId === itemKey.accountId &&
        oldInboxEntryItem &&
        !newInboxEntryItemPartial2.isArchived &&
        oldInboxEntryItem.isArchived;

    let newInboxEntryItemGeneration: number;
    let newInboxEntryItemEnteredTime: Date;

    if (shouldMoveToTop) {
        // Move our entry to the higher generation of:
        //
        // - The entry's current generation
        // - The inbox's current generation plus an increment if this is a loud
        //   notification since loud notifications should appear on top
        //
        // If our entry moves to a higher generation (usually due to a loud notification)
        // then it should stay at that generation.
        newInboxEntryItemGeneration = Math.max(
            ...(oldInboxEntryItem ? [oldInboxEntryItem.generation] : []),
            inboxGeneration +
                (loudNotificationCountDifference > 0
                    ? loudNotificationInboxGenerationIncrement
                    : hasActorUnarchivedOwnEntry
                      ? unarchivedInboxOwnEntryGenerationIncrement
                      : 0),
        );

        newInboxEntryItemEnteredTime = hasActorUnarchivedOwnEntry
            ? currentTime
            : getInboxEntryLatestUpdateTime(newInboxEntryItemPartial2);
    }
    // When we archive an item it goes back to our inbox generation. That way if it's
    // unarchived it doesn't go back into the loud notification generation.
    else if (newInboxEntryItemPartial2.isArchived && !oldInboxEntryItem.isArchived) {
        newInboxEntryItemGeneration = inboxGeneration;
        newInboxEntryItemEnteredTime = currentTime;
    } else {
        newInboxEntryItemGeneration = oldInboxEntryItem.generation;
        newInboxEntryItemEnteredTime = oldInboxEntryItem.enteredTime;
    }

    const newInboxEntryItem: InboxEntryItem = {
        ...newInboxEntryItemPartial2,
        generation: newInboxEntryItemGeneration,
        enteredTime: newInboxEntryItemEnteredTime,
    };

    return {
        newInboxItem: DynamoItem.createOrUpdate(oldInboxItem, newInboxItem),
        newInboxEntryItem: DynamoItem.createOrUpdate(oldInboxEntryItem, newInboxEntryItem),
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
            return entryItem.lastAddedPostCreatedTime;
        case "DocumentCommentThreadEntry":
            return entryItem.latestComment.createdTime;
        case "DocumentNewCommentThreadsEntry":
            return entryItem.lastAddedCommentThreadCreatedTime;
        case "TaskEntry":
            return entryItem.latestComment.createdTime;
        default:
            throw exhaustive(entryItem);
    }
}
