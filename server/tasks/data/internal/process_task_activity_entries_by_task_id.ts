import {addDays} from "date-fns";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {RynamoTableSchema} from "~/server/rynamo/rynamo_table_schema.js";
import {
    TaskActivityEntryChange,
    TaskActivityIdempotencyKey,
    TaskActivityTable,
} from "~/server/tasks/data/internal/task_activity_table.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {TaskActionTransactionId, TaskActivityEntryId} from "~/shared/id/types/id_types.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {TaskActivityModel} from "~/shared/tasks/task_activity.js";
import {TaskCreator} from "~/shared/tasks/task_creator.js";

// Idempotency markers must outlive the longest possible redelivery of their source
// update: job queue SQS retention (at most 14 days) plus `wasProcessed` sweeper
// retries (seconds). A marker that expires before the last redelivery would
// project its source update twice.
const taskActivityMarkerExpirationDays = 30;

// Each group writes at most 2 items, so this many groups stay inside DynamoDB's
// 100-item transaction cap.
const maxEntryGroupsPerTransaction = 50;

export const processTaskActivityEntryGroupsBeforeTransactionTestCheckpoint = new TestCheckpoint<{
    idempotencyKey: TaskActivityIdempotencyKey;
    firstActionTime: HybridLogicalTime | null;
}>();

/**
 * Projects a transaction's discrete entry groups: for each unprocessed group, one
 * entry (when it has changes) plus its idempotency marker, batched into as few
 * DynamoDB transactions as the 100-item cap allows — a 50-descendant delete is one
 * transaction, not 50. Groups whose markers already exist (sweeper replay, crash
 * recovery, duplicate delivery) project nothing.
 *
 * A group with no changes writes marker-only so a later replay does not create an
 * entry for a source the caller intentionally omitted.
 *
 * Title/notes window updates don't flow through here — they're marker-free and
 * apply through `applyTaskActivityWindowUpdate()`.
 *
 * Returns the realtime events for the entries this call actually wrote.
 */
export async function processTaskActivityEntriesByTaskId(
    context: ServerActionContext,
    spaceId: SpaceId,
    actor: TaskCreator | null,
    actionTransactionId: TaskActionTransactionId,
    changesByTaskId: ReadonlyMap<TaskId, ReadonlyArray<TaskActivityEntryChange>>,
): Promise<Array<RynamoEvent<TaskActivityModel>>> {
    if (changesByTaskId.size === 0) return [];

    const events: Array<RynamoEvent<TaskActivityModel>> = [];
    let hasConflicted = false;

    await context.dynamo.retryTransaction(async context => {
        const consistency = hasConflicted ? "StrongWithinCache" : undefined;
        hasConflicted = true;

        const processedTaskIds = new Set<TaskId>();
        await runAllPromises(
            mapIterable(changesByTaskId.keys(), async taskId => {
                const markerItem = await TaskActivityTable.getItemIfExists(
                    context,
                    {
                        partitionType: "ProcessedSource",
                        sortRangeType: "Marker",
                        idempotencyKey: `${actionTransactionId}:${taskId}`,
                    },
                    {consistency},
                );
                if (markerItem) processedTaskIds.add(taskId);
            }),
        );

        // A batch that partially committed before a retry re-enters here: committed groups
        // now have markers and drop out, so nothing projects twice.
        const unprocessedChanges = Array.from(
            filterIterable(changesByTaskId, ([taskId]) => !processedTaskIds.has(taskId)),
        );

        const batches = [];

        // A transaction that changed more tasks than fit under the 100-item cap splits
        // into multiple DynamoDB transactions.
        for (
            let batchStart = 0;
            batchStart < unprocessedChanges.length;
            batchStart += maxEntryGroupsPerTransaction
        ) {
            batches.push(
                unprocessedChanges.slice(batchStart, batchStart + maxEntryGroupsPerTransaction),
            );
        }

        await runAllPromises(
            batches.map(async batch => {
                const transactionEntries = [];
                const getEvents = [];
                const [firstTaskId, firstChanges] = assertExists(batch[0]);

                for (const [taskId, changes] of batch) {
                    transactionEntries.push(
                        createTaskActivityMarkerTransaction({
                            idempotencyKey: `${actionTransactionId}:${taskId}`,
                            spaceId,
                            taskId,
                        }),
                    );

                    if (changes.length === 0) continue;

                    const {transactionEntry, getEvent} =
                        TaskActivityTable.transactionCreateItemWithEvent({
                            partitionType: "Task",
                            sortRangeType: "ActivityEntry",
                            spaceId,
                            taskId,
                            activityEntryId: generateChronologicalId<TaskActivityEntryId>(),
                            actor,
                            changes,
                        });
                    transactionEntries.push(transactionEntry);
                    getEvents.push(getEvent);
                }

                await processTaskActivityEntryGroupsBeforeTransactionTestCheckpoint.waitForTest({
                    idempotencyKey: `${actionTransactionId}:${firstTaskId}`,
                    firstActionTime: firstChanges[0]?.actionTime ?? null,
                });

                const [, transactionEvents] = await runAllPromises([
                    RynamoTableSchema.executeTransaction(context, transactionEntries),
                    runAllPromises(getEvents.map(getEvent => getEvent(context))),
                ]);

                for (const transactionEvent of transactionEvents) {
                    // Collected only after the batch commits, so a failed batch never reports events
                    // and a retried call reports each entry once.
                    events.push(transactionEvent);
                }
            }),
        );
    });

    return events;
}

function createTaskActivityMarkerTransaction({
    idempotencyKey,
    spaceId,
    taskId,
}: {
    idempotencyKey: TaskActivityIdempotencyKey;
    spaceId: SpaceId;
    taskId: TaskId;
}) {
    const processedTime = new Date();
    return TaskActivityTable.transactionCreateItem(
        {
            partitionType: "ProcessedSource",
            sortRangeType: "Marker",
            idempotencyKey,
            spaceId,
            taskId,
            processedTime,
            expirationTime: addDays(processedTime, taskActivityMarkerExpirationDays),
        },
        {isConditionCheckErrorRetriable: true},
    );
}
