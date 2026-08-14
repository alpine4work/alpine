import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import {RynamoTableItemType, RynamoTableSchema} from "~/server/rynamo/rynamo_table_schema.js";
import {getAccountOrDangerouslyGetStubWithoutAuthorization} from "~/server/spaces/get_account_or_dangerously_get_stub_without_authoriztion.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {TaskActionTransactionId, TaskActivityEntryId} from "~/shared/id/types/id_types.js";
import {AccountId, SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
import {createModelUnionSchema} from "~/shared/schema/model/create_model_union_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {
    TaskActivityActor,
    TaskActivityChangeBaseSchema,
    TaskActivityChangeSchemasWithoutAccountReferences,
    TaskActivityFeedDiscreteEntryModel,
    TaskActivityFeedWindowChunkModel,
    TaskActivityModel,
} from "~/shared/tasks/task_activity.js";
import {TaskActivityWindowChunkActor} from "~/shared/tasks/task_activity_window_chunk.js";
import {TaskCreatorSchema} from "~/shared/tasks/task_creator.js";

/**
 * Internal Rynamo model for activity processing items that are never sent to
 * clients.
 */
class TaskActivityInternalModel extends Model(Schema.object({})) {}

const TaskActivityEntryChangeSchema = Schema.union({
    ...TaskActivityChangeSchemasWithoutAccountReferences,
    TaskAssigneeUpdated: TaskActivityChangeBaseSchema.merge(
        Schema.object({
            type: Schema.value("TaskAssigneeUpdated"),
            previousAssigneeId: Schema.id<AccountId>().nullable().optional(),
            assigneeId: Schema.id<AccountId>().nullable(),
        }),
    ),
});

export type TaskActivityEntryChange = SchemaType<typeof TaskActivityEntryChangeSchema>;

/**
 * A stable idempotency key for one source update normalized by the activity
 * engine. Its marker item (the `ProcessedSource` partition) is created in the same
 * transaction as the update's projection, making processing exactly-once across
 * SQS redelivery, sweeper replay, and crash recovery.
 *
 * One marker per action transaction per task (see
 * `emitTaskActivityFromIndexAttempt()`).
 */
export type TaskActivityIdempotencyKey = `${TaskActionTransactionId}:${TaskId}`;

/**
 * The content state at the open window's start (null when unknown, e.g. a
 * crash-recovery fallback). The end state isn't stored: it's the next window's
 * start, or for the latest window the task's current title/notes. `wasReverted` on
 * the window record is computed against this start at absorb time, so clients
 * never need content to render.
 */
export const TaskActivityWindowSnapshotContentSchema = Schema.union({
    Title: Schema.object({
        type: Schema.value("Title"),
        /**
         * Storing only the start text means the snapshot is written once [1], when the
         * window is created, instead of transactionally on every title update. Writes
         * within the window ignore the snapshot entirely — the rare exception is
         * bookkeeping that absorbs an earlier update into the window as its new start
         * activity.
         *
         * [1] Sort of. They can technically be written again if an event comes out of
         * order, before the current window has started AND the event should have started
         * the window.
         */
        startTitleText: Schema.string.nullable(),
    }),
    Notes: Schema.object({
        type: Schema.value("Notes"),
        // See comment on `startTitleText` for why we don't store the end content hash.
        startContentHash: Schema.string.nullable(),
    }),
});

export type TaskActivityWindowSnapshotContent = SchemaType<
    typeof TaskActivityWindowSnapshotContentSchema
>;

const TaskActivityTableModelSchema = createModelUnionSchema({
    TaskActivityEntry: TaskActivityFeedDiscreteEntryModel,
    TaskActivityWindowChunk: TaskActivityFeedWindowChunkModel,
    TaskActivityInternal: TaskActivityInternalModel,
});

/**
 * Materialized task activity and the small amount of processing state required to
 * update it idempotently.
 *
 * Request flow and approximate cost per action transaction with N user-visible
 * candidates (most transactions have N ≤ 1):
 *
 * 1. **Commit** carries no activity cost. Candidates are captured while the
 *    transaction is indexed into the OpenSearch task index and emitted after the
 *    winning doc write (see `TaskActionTransactionIndexState`), retried by the
 *    `wasProcessed` sweeper.
 * 2. **Projection**, per candidate: one to three reads (source marker, and for
 *    title/notes windows the field's latest window chunk plus the open window's
 *    snapshot) and one two-to-four item transaction (marker, entry create or chunk
 *    write — plus a second chunk write on a rollover split — and the window
 *    snapshot). Effective noops write a marker only.
 * 3. Every write in the `Task` partition also writes a realtime event item (the
 *    `realtimeQuery` feature), and a transaction's entry/chunk events are
 *    broadcast in ONE request to the task's `TaskNotesCollaborationService`
 *    durable object (dropped entirely when nobody is connected to it).
 * 4. **Feed reads** load the task's discrete entries and window chunks with a base
 *    realtime query (clients decode chunks and sort/aggregate themselves), plus
 *    checkpoint-based backfill queries when a client reconnects.
 */
export const TaskActivityTable = RynamoTableSchema.new({
    features: {
        // Clients load a task's whole activity log with a base realtime query and
        // sort/aggregate on the client, so the partition pays the extra realtime event WCU
        // instead of maintaining a replicated index.
        realtimeQuery: {Task: true},
    },
    name: "TaskActivity",
    partitions: [
        {
            name: "Task",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                taskId: DynamoKeyAttributeSchema.id<TaskId>(),
            },
            sortRanges: [
                {
                    name: "ActivityEntry",
                    sortKeyAttributes: {
                        /** Stable identity for one discrete entry. */
                        activityEntryId: DynamoKeyAttributeSchema.id<TaskActivityEntryId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * The responsible account and bot provenance, or NULL FOR A SYSTEM UPDATE — an
                         * update with no responsible account (automation, background maintenance). Null
                         * actors are meaningful data, not absence: the feed renders them as "Alpine", and
                         * a window's actor list keeps them so a system edit is never silently credited to
                         * the humans in the same window (see `appendTaskActorIfNew()` and the codec's
                         * `nullActorIndex`).
                         *
                         * Stored activity carries account ids only, which keeps this table normalized.
                         * Account models are hydrated when building the client model.
                         */
                        actor: TaskCreatorSchema.nullable(),
                        /**
                         * The field values and logical times of the updates the entry's source transaction
                         * attributed to this task. Never empty — a transaction whose actions produce no
                         * activity writes only its idempotency marker.
                         */
                        changes: Schema.array(TaskActivityEntryChangeSchema),
                    }),
                },
                /**
                 * Binary-encoded notes activity windows, many per item (see
                 * `encodeTaskActivityWindowChunk()`), keyed by a dense chunk number. The open
                 * notes window is always the last window of the latest chunk — there is no pointer
                 * item to maintain. Chunks are capped small (see
                 * `taskActivityWindowChunkMaxByteLength`) because every absorb rewrites the whole
                 * item; when a chunk would overflow, a new chunk starts.
                 */
                {
                    name: "NotesWindowChunks",
                    sortKeyAttributes: {
                        /**
                         * Densely packed from 1, incrementing by one, which is what lets reads be
                         * eventually consistent. Chunk creation is a conditional create of the next number
                         * (plus a transactional `sealedTime` seal of the predecessor), so two racing
                         * writers collide instead of both succeeding, and every decision made on a stale
                         * eventually consistent read fails a condition at write time. Reads are eventual
                         * by default, strong only on conflict retry.
                         */
                        chunkNumber: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        /**
                         * When this chunk stopped being the field's latest — set transactionally by the
                         * creation of its successor or when a committed comment ends the current
                         * aggregation window. Either write bumps this item's update lock so a stale absorb
                         * fails. Null while this chunk can still absorb updates. Never absorb into a
                         * sealed chunk.
                         */
                        sealedTime: Schema.date.nullable(),
                        /** Base time for the window records' second-precision time deltas. */
                        baseTime: Schema.date,
                        /**
                         * The actor dictionary window records reference by index (1 byte per stored
                         * actor). Kept as `actors` for symmetry with the discrete entries' `actor`.
                         * Per-window storage is capped (see `maxStoredActorsPerWindow`); the dictionary
                         * holds each distinct contributor once, with bot provenance.
                         */
                        actors: Schema.array(
                            Schema.object({
                                accountId: Schema.id<AccountId>(),
                                fromBotAccountId: Schema.id<AccountId>().nullable(),
                            }),
                        ),
                        /**
                         * A one-byte format-version header followed by one binary-encoded record per
                         * window (see `encodeTaskActivityWindows()`).
                         */
                        windows: Schema.array(Schema.bytes),
                    }),
                },
                /**
                 * Binary-encoded title activity windows; see `NotesWindowChunks`.
                 */
                {
                    name: "TitleWindowChunks",
                    sortKeyAttributes: {
                        /** Densely packed from 1; see `NotesWindowChunks`. */
                        chunkNumber: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        /** See `NotesWindowChunks`. */
                        sealedTime: Schema.date.nullable(),
                        /** Base time for the window records' second-precision time deltas. */
                        baseTime: Schema.date,
                        /** The actor dictionary window records reference by index. */
                        actors: Schema.array(
                            Schema.object({
                                accountId: Schema.id<AccountId>(),
                                fromBotAccountId: Schema.id<AccountId>().nullable(),
                            }),
                        ),
                        /** One binary-encoded record per window. */
                        windows: Schema.array(Schema.bytes),
                    }),
                },
                /**
                 * Content bookkeeping for one title/notes window, keyed by the window's id from
                 * its chunk. Holds the rendered content state (title text, or notes content hash)
                 * at the window's start and latest end so each absorb can recompute `wasReverted`
                 * with a single keyed read.
                 *
                 * Kept out of the window chunks so activity feed queries never pay read capacity
                 * for content bytes. Created transactionally with its window and updated on every
                 * absorb. Never sent to clients — a future "show changes" view reads it (titles)
                 * or folds the notes step transactions by the window's version range (notes).
                 */
                {
                    name: "WindowSnapshot",
                    sortKeyAttributes: {
                        activityEntryId: DynamoKeyAttributeSchema.id<TaskActivityEntryId>(),
                    },
                    attributes: Schema.object({
                        content: TaskActivityWindowSnapshotContentSchema,
                        /**
                         * EVERY distinct contributor to the window, uncapped and in first-contribution
                         * order — the dedup list absorbs check against. The window record in the chunk
                         * stores only the first `maxStoredActorsPerWindow` of these plus the total count.
                         */
                        actors: Schema.array(TaskCreatorSchema.nullable()),
                    }),
                },
            ],
        },
        /**
         * The idempotency spine of activity processing: one marker item per normalized
         * source update, created in the SAME transaction as the update's projection. SQS
         * redelivery, sweeper replay, and the crash-recovery fallback all check the marker
         * first and converge to exactly-once. These are permanent processed-records, not
         * leases — the TTL is garbage collection (markers must outlive the longest
         * possible redelivery), not expiry semantics.
         */
        {
            name: "ProcessedSource",
            partitionKeyAttributes: {
                /** Globally unique idempotency key for one normalized source update. */
                idempotencyKey: DynamoKeyAttributeSchema.labelString<TaskActivityIdempotencyKey>({
                    maxLength: null,
                }),
            },
            sortRanges: [
                {
                    name: "Marker",
                    sortKeyAttributes: {},
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),
                        taskId: Schema.id<TaskId>(),
                        /** When the source update was successfully projected. */
                        processedTime: Schema.date,
                    }),
                },
            ],
        },
    ],
    modelSchema: TaskActivityTableModelSchema,
    models: {
        Task: {
            ActivityEntry: {
                async build(context, item): Promise<TaskActivityFeedDiscreteEntryModel> {
                    return await intoActivityEntryModel(context, item);
                },
            },
            NotesWindowChunks: {
                async build(context, item) {
                    return new TaskActivityFeedWindowChunkModel({
                        chunkNumber: item.chunkNumber,
                        spaceId: item.spaceId,
                        taskId: item.taskId,
                        contentField: "Notes",
                        baseTime: item.baseTime,
                        actors: await getTaskActivityActors(context, item.spaceId, item.actors),
                        windows: item.windows,
                    });
                },
            },
            TitleWindowChunks: {
                async build(context, item) {
                    return new TaskActivityFeedWindowChunkModel({
                        chunkNumber: item.chunkNumber,
                        spaceId: item.spaceId,
                        taskId: item.taskId,
                        contentField: "Title",
                        baseTime: item.baseTime,
                        actors: await getTaskActivityActors(context, item.spaceId, item.actors),
                        windows: item.windows,
                    });
                },
            },
            WindowSnapshot: {
                async build() {
                    // TODO(#see-more-task-activity): When we implement a diff view for task activity,
                    // we'll use this snapshot to determine the from/to versions of Task Note updates
                    // and the from/to title text for each title window update. For now, we don't need
                    // to return this to the client in realtime.
                    //
                    // We'll also have to decide if we want to set up a realtime connection to this
                    // item so that the diff view captures updates while client is viewing it. My
                    // answer right now is "probably not, diff views are static. re-opening the view
                    // will re-fetch the snapshot, which will have the most recent updates".
                    return new TaskActivityInternalModel({});
                },
            },
        },
        ProcessedSource: {
            Marker: {
                async build() {
                    return new TaskActivityInternalModel({});
                },
            },
        },
    },
    broadcastEvents: async (context, events) => {
        // Group the transaction's client-visible events per task and broadcast each task's
        // batch as ONE request per realtime host — the pattern `SitesTable`/`InboxTable`
        // use — instead of a serial fan-out per event.
        const clientEvents = await runAllPromises(
            events
                .filter(({itemKey}) => {
                    return (
                        itemKey.partitionType === "Task" &&
                        (itemKey.sortRangeType === "ActivityEntry" ||
                            itemKey.sortRangeType === "NotesWindowChunks" ||
                            itemKey.sortRangeType === "TitleWindowChunks")
                    );
                })
                .map(async ({itemKey, getEvent}) => {
                    assert(itemKey.partitionType === "Task");
                    const event = await getEvent(context);
                    assertTaskActivityClientEvent(event);
                    return {taskId: itemKey.taskId, event};
                }),
        );

        const eventsByTaskId = new Map<
            TaskId,
            {
                events: Array<(typeof clientEvents)[number]["event"]>;
            }
        >();
        for (const {taskId, event} of clientEvents) {
            const taskEvents = getOrSetDefaultMapValue(eventsByTaskId, taskId, () => ({
                events: [],
            }));
            taskEvents.events.push(event);
        }

        await runAllPromises(
            Array.from(eventsByTaskId, async ([taskId, {events}]) => {
                await context.tasks.broadcastTaskActivityEvents({taskId, events});
            }),
        );
    },
});

export type TaskActivityEntryItem = RynamoTableItemType<
    typeof TaskActivityTable,
    "Task",
    "ActivityEntry"
>;

export type TaskActivityNotesWindowChunkItem = RynamoTableItemType<
    typeof TaskActivityTable,
    "Task",
    "NotesWindowChunks"
>;

export type TaskActivityTitleWindowChunkItem = RynamoTableItemType<
    typeof TaskActivityTable,
    "Task",
    "TitleWindowChunks"
>;

export type TaskActivityWindowSnapshotItem = RynamoTableItemType<
    typeof TaskActivityTable,
    "Task",
    "WindowSnapshot"
>;

export type TaskActivityEntryDynamoItem = DynamoItem<TaskActivityEntryItem>;
export type TaskActivityWindowChunkDynamoItem = DynamoItem<
    TaskActivityNotesWindowChunkItem | TaskActivityTitleWindowChunkItem
>;
export type TaskActivityWindowSnapshotDynamoItem = DynamoItem<TaskActivityWindowSnapshotItem>;

function assertTaskActivityClientEvent(
    event: RynamoEvent<
        | TaskActivityFeedWindowChunkModel
        | TaskActivityFeedDiscreteEntryModel
        | TaskActivityInternalModel
    >,
): asserts event is RynamoEvent<TaskActivityModel> {
    if (event.type === "DeleteItem") return;
    assert(!(event.item.model instanceof TaskActivityInternalModel));
}

async function getTaskActivityAccount(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<AccountModel> {
    return await getAccountOrDangerouslyGetStubWithoutAuthorization(context, spaceId, accountId);
}

async function getTaskActivityActors(
    context: ServerActionContext,
    spaceId: SpaceId,
    actors: ReadonlyArray<TaskActivityWindowChunkActor>,
): Promise<ReadonlyArray<TaskActivityActor>> {
    return await runAllPromises(
        actors.map(async actor => {
            const [account, from] = await runAllPromises([
                getTaskActivityAccount(context, spaceId, actor.accountId),
                actor.fromBotAccountId === null
                    ? Promise.resolve(null)
                    : getTaskActivityAccount(context, spaceId, actor.fromBotAccountId),
            ]);

            return {account, from};
        }),
    );
}

async function intoActivityEntryModel(
    context: ServerActionContext,
    item: TaskActivityEntryItem,
): Promise<TaskActivityFeedDiscreteEntryModel> {
    const actorPromises = [];
    if (item.actor !== null) {
        actorPromises.push(getTaskActivityAccount(context, item.spaceId, item.actor.accountId));
    }

    // If there's no account Id and there's a from account Id, something went wrong,
    // ignore this case. if this pops up, we can decide what to do with it.
    if (item.actor?.from !== null && item.actor?.from !== undefined) {
        actorPromises.push(
            getTaskActivityAccount(context, item.spaceId, item.actor.from.accountId),
        );
    }

    const actorPromise =
        actorPromises.length > 0
            ? runAllPromises(actorPromises).then(
                  ([account, from]): TaskActivityActor => ({
                      account: assertExists(account),
                      from: from ?? null,
                  }),
              )
            : null;

    const changesPromise = runAllPromises(
        item.changes.map(async change => {
            if (change.type !== "TaskAssigneeUpdated") return change;

            const [previousAssignee, assignee] = await runAllPromises([
                change.previousAssigneeId === undefined || change.previousAssigneeId === null
                    ? change.previousAssigneeId
                    : getTaskActivityAccount(context, item.spaceId, change.previousAssigneeId),
                change.assigneeId === null
                    ? null
                    : getTaskActivityAccount(context, item.spaceId, change.assigneeId),
            ]);

            return {
                type: change.type,
                actionTime: change.actionTime,
                previousAssignee,
                assignee,
            };
        }),
    );

    const [actor, changes] = await runAllPromises([actorPromise, changesPromise]);

    return new TaskActivityFeedDiscreteEntryModel({
        activityEntryId: item.activityEntryId,
        spaceId: item.spaceId,
        taskId: item.taskId,
        actor,
        changes,
    });
}
