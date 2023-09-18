import {addMonths, differenceInMonths} from "date-fns";
import murmurhash from "murmurhash";
import {
    ServerSessionActionContext,
    ServerSessionActionContextModules,
} from "~/server/context/server_action_context.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {TestCounter} from "~/server/helpers/test/test_counter.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {authorizeSpaceAccess, isAccountMemberOfSpace} from "~/server/spaces/spaces_table.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskContextModuleBase} from "~/server/tasks/data/task_context_module.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {CacheContextModule, ContextCache} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {createCrdtRegister} from "~/shared/crdt/crdt_register.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {stringifyForDeepEqualCheck} from "~/shared/helpers/control/stringify_for_deep_equal_check.js";
import {filterMapArray} from "~/shared/helpers/iterable/filter_map_array.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {decodeIdInto, encodeId, generateId, getMinId, idByteLength} from "~/shared/id/id.js";
import {
    AccountId,
    BrowserId,
    SpaceId,
    TaskActionTransactionId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {HybridLogicalTimeSchema} from "~/shared/schema/helpers/hybrid_logical_time_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    TaskAction,
    TaskActionSchema,
    getTaskActionLabel,
} from "~/shared/tasks/actions/task_action.js";
import {TaskParentTaskIdRegister} from "~/shared/tasks/actions/task_task_action.js";
import {
    TaskCollectionAccessLevel,
    TaskCollectionAccessPolicy,
    TaskCollectionAccessPolicyRegister,
    hasTaskCollectionAccessLevel,
} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {
    TaskGridViewExpansionState,
    TaskGridViewExpansionStateSchema,
} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {
    TaskNotepadPageIdCompressedSet,
    TaskNotepadPageIdCompressedSetSchema,
    generateTaskNotepadPageId,
} from "~/shared/tasks/task_notepad_page_id.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskStatus} from "~/shared/tasks/task_status.js";

/**
 * The task actions table is the canonical representation of the data in our
 * task system. Everything else is derived from task actions. We should be able
 * to rebuild any of our structures from the task actions table. When an action
 * commits to this table it has been accepted by our system and should
 * propagate to all realtime clients.
 *
 * In practice, we only end up reading the last ~24 hours of task actions as we
 * incrementally keep other databases, like OpenSearch, up-to-date. Eventually
 * we should find a way to archive old actions. We MUST keep old actions around
 * since we consider actions to be the canonical representation of data in our
 * task system but DynamoDB storage is expensive. Realistically old actions
 * are basically only accessed in disaster recovery scenarios so they can go
 * into low cost S3 storage.
 */
const TaskActionTable = DynamoTableSchema.new({
    name: "TaskActions",
    partitions: [
        {
            name: "TaskActions",
            partitionKeyAttributes: {
                /**
                 * The space who's tasks this action affected.
                 */
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                {
                    name: "ActionTransaction",
                    sortKeyAttributes: {
                        /**
                         * The time at which the action was accepted. May be different from whatever
                         * `createdTime` or `updatedTime` is reported in the action itself.
                         */
                        committedTime: DynamoKeyAttributeSchema.date,

                        /**
                         * An `Id` for uniquely representing an action. Also used to disambiguate
                         * actions with identical `committedTime`s.
                         */
                        actionTransactionId: DynamoKeyAttributeSchema.id<TaskActionTransactionId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * Actions which should always be atomically applied together.
                         */
                        actions: Schema.array(TaskActionSchema),

                        /**
                         * Has this action transaction been processed? To consider an action
                         * transaction processed we must have:
                         *
                         * 1. Indexed the transaction in OpenSearch
                         * 2. Applied the transaction on all relevant task realtime servers
                         *
                         * We maintain an index of all actions across all spaces that haven't been
                         * processed so we can retry if necessary.
                         */
                        wasProcessed: Schema.boolean,
                    }),
                },
            ],
        },
    ],
});

// Allow querying unprocessed action transactions across all spaces.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const UnprocessedActionTransactionsIndex = TaskActionTable.addIndex({
    name: "UnprocessedActionTransactions",
    itemTypes: [{partitionType: "TaskActions", sortRangeType: "ActionTransaction"}],
    partitionKeyAttributes: {
        wasProcessed: DynamoKeyAttributeSchema.boolean,
    },
    sortKeyAttributes: {
        committedTime: DynamoKeyAttributeSchema.date,
    },
    filter: item => !item.wasProcessed,
});

const TaskStatusTypeRegister = createCrdtRegister(
    Schema.enum<TaskStatus["type"]>(["Open", "Closed"]),
);

const TaskAssigneeAccountIdRegister = createCrdtRegister(Schema.id<AccountId>().nullable());

/**
 * Data related to tasks. Contains some views of task actions (e.g. the
 * `EssentialAttributes` items) and some data unrelated to task fields which
 * don't participate in querying (like notes, comments, revision history).
 */
export const TaskTable = DynamoTableSchema.new({
    name: "Tasks",
    partitions: [
        {
            name: "Account",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                {
                    name: "Notepad",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        pageIds: TaskNotepadPageIdCompressedSetSchema,
                    }),
                },
            ],
        },
        {
            name: "TaskCollection",
            partitionKeyAttributes: {
                collectionId: DynamoKeyAttributeSchema.id<TaskCollectionId>(),
            },
            sortRanges: [
                {
                    name: "EssentialAttributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),
                        createdTime: HybridLogicalTimeSchema,
                        deletedTime: HybridLogicalTimeSchema.nullable(),
                        accessPolicy: TaskCollectionAccessPolicyRegister.schema,
                    }),
                },
            ],
        },
        {
            name: "Task",
            partitionKeyAttributes: {
                taskId: DynamoKeyAttributeSchema.id<TaskId>(),
            },
            sortRanges: [
                {
                    name: "EssentialAttributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),

                        /**
                         * The account who created this task. The creator of a task always has edit
                         * level permission to the task.
                         */
                        creatorId: Schema.id<AccountId>(),

                        /**
                         * The time this task was created.
                         */
                        createdTime: HybridLogicalTimeSchema,

                        /**
                         * The time this task was deleted. We keep a record of deleted tasks so they
                         * may be undeleted. It's critical to check this property when looking at task
                         * items so you know whether it's been deleted or not.
                         */
                        deletedTime: HybridLogicalTimeSchema.nullable(),

                        /**
                         * The status of this task. Either `Open` or `Closed`.
                         */
                        statusType: TaskStatusTypeRegister.schema,

                        /**
                         * The parent of this task.
                         *
                         * ## Permissions
                         *
                         * We inherit permissions from this task. So if you have edit access to the
                         * parent task then you also have edit access to this task.
                         *
                         * You may have broader permissions to a child task. For example, you can edit
                         * a child task but not its parent task. Or view a child task but not its
                         * parent task.
                         *
                         * ## Parent deletion
                         *
                         * When a parent task is deleted we don't update the `parentTaskId` attribute
                         * of child tasks. You must be careful to check that the `parentTaskId` task
                         * actually exists and is not deleted. We leave gravestones around for deleted
                         * tasks so you should always be able to find a task object even if it's
                         * deleted.
                         *
                         * If the parent task is undeleted the child task is again unaffected.
                         *
                         * ## Depth and circular dependency restrictions
                         *
                         * There is no restriction on how deep you can nest child tasks.
                         *
                         * Task circular dependencies are not allowed. Though clients may temporarily
                         * have circular dependencies. This is because:
                         *
                         * - Task actions may be applied out-of-order
                         * - We may not load the entire task parent hierarchy so we won't know to
                         *   reject an operation that creates a circular dependency
                         *
                         * So clients should be careful not to crash on circular dependencies. However,
                         * a canonical task representation will never have circular dependencies.
                         *
                         * There may also be items in this table that have a circular dependency
                         * because deleted tasks do not count in a dependency chain. If you are
                         * iterating through a parent task chain, make sure to `break` if you see a
                         * deleted parent task.
                         */
                        parentTaskId: TaskParentTaskIdRegister.schema,

                        // See the documentation of `TaskUpdateChildrenCountsAction` for more
                        // information.
                        // NOCOMMIT: Should update these with delete/undelete?
                        addedChildTaskCount: Schema.integer,
                        removedChildTaskCount: Schema.integer,
                        addedClosedChildTaskCount: Schema.integer,
                        removedClosedChildTaskCount: Schema.integer,

                        /**
                         * All of this task's current children.
                         *
                         * Stored in binary since that's much more space efficient than storing as
                         * strings. 1kb (used by 1 WCU) costs ~64 128 bit `Id`s.
                         *
                         * Unlike `addedChildTaskCount` these are our current child tasks. If a child
                         * task is removed then we remove it from the set. If a child task is deleted
                         * it stays in the set, though.
                         */
                        childTaskIds: Schema.bytes.transform<ReadonlySet<TaskId>>({
                            serialize: taskIds => {
                                const bytes = new Uint8Array(taskIds.size * idByteLength);

                                let byteOffset = 0;
                                for (const taskId of taskIds) {
                                    decodeIdInto(taskId, bytes, byteOffset);
                                    byteOffset += idByteLength;
                                }

                                return bytes;
                            },
                            deserialize: bytes => {
                                const taskIds = new Set<TaskId>();

                                for (
                                    let byteOffset = 0;
                                    byteOffset + idByteLength <= bytes.byteLength;
                                    byteOffset += idByteLength
                                ) {
                                    taskIds.add(encodeId(bytes, byteOffset));
                                }

                                return taskIds;
                            },
                        }),

                        /**
                         * The collections this task is a part of. A task inherits the highest access
                         * level from its collections.
                         */
                        collections: TaskCollectionSet.schema,

                        /**
                         * The account which was assigned this task.
                         */
                        assigneeId: TaskAssigneeAccountIdRegister.schema,
                    }),
                },
            ],
        },
        {
            name: "TaskGridViewExpansionState",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                browserId: DynamoKeyAttributeSchema.id<BrowserId>(),
                viewKey: DynamoKeyAttributeSchema.labelString,
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        // Store state as a string in DynamoDB to get around DynamoDB's object nesting
                        // limits since this is a recursive data type. (Ideally binary someday.)
                        state: Schema.unknown.transform<TaskGridViewExpansionState>({
                            serialize: state =>
                                JSON.stringify(TaskGridViewExpansionStateSchema.serialize(state)),
                            deserialize: state =>
                                typeof state === "string"
                                    ? TaskGridViewExpansionStateSchema.deserialize(
                                          JSON.parse(state),
                                      )
                                    : TaskGridViewExpansionStateSchema.deserialize(state),
                        }),
                    }),
                },
            ],
        },
    ],
});

type TaskActionTransactionItem = DynamoTableItemType<
    typeof TaskActionTable,
    "TaskActions",
    "ActionTransaction"
>;

type TaskAccountNotepadItem = DynamoTableItemType<typeof TaskTable, "Account", "Notepad">;

export type TaskEssentialAttributesItem = DynamoTableItemType<
    typeof TaskTable,
    "Task",
    "EssentialAttributes"
>;

type TaskCollectionEssentialAttributesItem = DynamoTableItemType<
    typeof TaskTable,
    "TaskCollection",
    "EssentialAttributes"
>;

/**
 * Get the item representing a task in unit tests.
 */
export async function getTaskItemForTest(
    context: DynamoContext,
    taskId: TaskId,
): Promise<TaskEssentialAttributesItem> {
    assert(import.meta.jest);

    return TaskTable.getItem(context, {
        partitionType: "Task",
        sortRangeType: "EssentialAttributes",
        taskId,
    });
}

export const commitTaskActionTransactionBeforeExecuteTestCheckpoint =
    new TestCheckpoint<AccountId>();

/**
 * Allow tests to subscribe to committed action transactions
 */
export const afterCommitTaskActionTransactionEventEmitterForTest = import.meta.jest
    ? new EventEmitter<{
          spaceId: SpaceId;
          committedTime: Date;
          actions: ReadonlyArray<TaskAction>;
      }>()
    : null;

/**
 * Commit a transaction of `TaskAction`s. Authorizes that each action is
 * valid before committing it.
 *
 * When actions are applied to some view they are commutative and idempotent.
 * That means you can apply them in any order and you can apply them multiple
 * times. However, this function is not commutative and idempotent.
 *
 * To successfully commit an action you need to be allowed to modify the data
 * specified in the action. This means committing actions depends on the
 * current state, hence this function can't be commutative.
 *
 * However, because we implement authorization here it means once an action is
 * committed any downstream consumers don't need to factor in authorization
 * rules at all. Downstream consumers can apply actions in any order (thanks to
 * their commutative property) multiple times (thanks to their idempotent
 * property).
 */
export function commitTaskActionTransaction(
    context: Context<ServerSessionActionContextModules & {tasks: TaskContextModuleBase}>,
    spaceId: SpaceId,
    actions: ReadonlyArray<TaskAction>,
): Promise<{extraActions: ReadonlyArray<TaskAction>}> {
    return context.tracer.withSpan("Commit task action transaction", async (context, span) => {
        span.addData({
            tasks: {
                actions: actions.map(getTaskActionLabel).join(","),
                actionCount: actions.length,
            },
        });

        const {actionTransactionItem, extraActions} = await TaskActionTransactionCommitState.commit(
            context,
            spaceId,
            actions,
        );

        span.addData({
            tasks: {
                actionTransactionId: actionTransactionItem.actionTransactionId,
            },
        });

        // Make sure we include extra actions in our `TracerSpan` if there were any.
        if (actionTransactionItem.actions.length > 0) {
            span.addData({
                tasks: {
                    actions: actionTransactionItem.actions.map(getTaskActionLabel).join(","),
                    actionCount: actionTransactionItem.actions.length,
                },
            });
        }

        afterCommitTaskActionTransaction(context, actionTransactionItem);

        return {extraActions};
    });
}

function afterCommitTaskActionTransaction(
    context: Context<ServerSessionActionContextModules & {tasks: TaskContextModuleBase}>,
    actionTransactionItem: TaskActionTransactionItem,
) {
    afterCommitTaskActionTransactionEventEmitterForTest?.emit({
        spaceId: actionTransactionItem.spaceId,
        committedTime: actionTransactionItem.committedTime,
        actions: actionTransactionItem.actions,
    });

    context.process.waitUntil(
        context.tracer.withSpan("Process task action transaction", async (context, span) => {
            span.addData({
                tasks: {
                    actions: actionTransactionItem.actions.map(getTaskActionLabel).join(","),
                    actionCount: actionTransactionItem.actions.length,
                    actionTransactionId: actionTransactionItem.actionTransactionId,
                },
            });

            // Process the action transaction in the background.
            //
            // TODO(calebmer): We need some way to recover if processing fails! Right now
            // maybe we can rely on a manual process where we look at the database for
            // unprocessed transactions and manually retry them. However, it's important
            // actions are processed in a timely manner so we should have some service
            // that's constantly querying the `TaskActions` table and retrying transactions
            // that are taking a while to process.
            await context.tasks.processActionTransactionAfterCommit(actionTransactionItem);

            // Once we've finished processing, flip the `wasProcessed` flag to true which
            // will also remove this transaction from our unprocessed transactions index.
            await TaskActionTable.createOrReplaceItem(context, {
                ...actionTransactionItem,
                wasProcessed: true,
            });
        }),
    );
}

/**
 * Abstraction for managing state during a `commitTaskActionTransaction()`
 * call. A task may be updated multiple times within a transaction so we need
 * to keep track of previous writes and return them if another action in the
 * transaction attempts to read again.
 */
class TaskActionTransactionCommitState {
    private readonly _context: ServerSessionActionContext;
    private readonly _spaceId: SpaceId;
    private readonly _startTime = Date.now();

    // We may only have one DynamoDB transaction entry for each item. So we need to
    // merge all updates we want to make on an item into a single transaction entry.
    private readonly _transactionEntryByTaskId = new Map<
        TaskId,
        {
            action: "CreateItem" | "DirectlyUpdateItem" | "DirectlyUpdateItemLockVersion";
            taskItem: TaskEssentialAttributesItem;
            shouldCommitExtraUpdateChildrenCountAction: boolean;
        }
    >();

    // We may only have one DynamoDB transaction entry for each item. So we need to
    // merge all updates we want to make on an item into a single transaction entry.
    private readonly _transactionEntryByCollectionId = new Map<
        TaskCollectionId,
        {
            action: "CreateItem" | "DirectlyUpdateItem";
            collectionItem: TaskCollectionEssentialAttributesItem;
        }
    >();

    private _actorNotepadItemTransactionEntry: TaskAccountNotepadItem | null = null;

    private readonly _taskItemById = new Map<TaskId, Promise<TaskEssentialAttributesItem | null>>();
    private readonly _collectionItemById = new Map<
        TaskCollectionId,
        Promise<TaskCollectionEssentialAttributesItem | null>
    >();
    private _actorNotepadItemPromise: Promise<TaskAccountNotepadItem> | null = null;

    private constructor(context: ServerSessionActionContext, spaceId: SpaceId) {
        this._context = context;
        this._spaceId = spaceId;
    }

    public static commit(
        context: ServerSessionActionContext,
        spaceId: SpaceId,
        actions: ReadonlyArray<TaskAction>,
    ): Promise<{
        actionTransactionItem: TaskActionTransactionItem;
        extraActions: ReadonlyArray<TaskAction>;
    }> {
        return context.dynamo.retryTransaction(async context => {
            await authorizeSpaceAccess(context, spaceId);

            if (!actions[0]) {
                throw new InvalidArgumentError("Must commit at least one action");
            }

            let maxActionTime = actions[0].time;
            for (let i = 1; i < actions.length; i++) {
                maxActionTime = maxHybridLogicalTime(maxActionTime, actions[i]!.time);
            }

            const state = new TaskActionTransactionCommitState(context, spaceId);

            await actuallyCommitTaskActionTransaction(state, spaceId, actions);

            const transactionEntries: Array<DynamoTransactionEntry> = [];
            const extraActions: Array<TaskAction> = [];

            for (const transactionEntry of state._transactionEntryByTaskId.values()) {
                switch (transactionEntry.action) {
                    case "CreateItem": {
                        transactionEntries.push(
                            TaskTable.transactionCreateItem(transactionEntry.taskItem),
                        );
                        break;
                    }
                    case "DirectlyUpdateItem": {
                        transactionEntries.push(
                            TaskTable.transactionDirectlyUpdateItem(transactionEntry.taskItem),
                        );
                        break;
                    }
                    case "DirectlyUpdateItemLockVersion": {
                        transactionEntries.push(
                            TaskTable.transactionDirectlyUpdateItemLockVersion(
                                transactionEntry.taskItem,
                                transactionEntry.taskItem.updateLockVersion,
                            ),
                        );
                        break;
                    }
                    default:
                        throw exhaustive(transactionEntry.action);
                }

                // If children counts were updated then we want to commit an extra action with
                // the authoritative child counts so all other clients have the correct
                // children count.
                if (transactionEntry.shouldCommitExtraUpdateChildrenCountAction) {
                    extraActions.push({
                        type: "UpdateTask",
                        // For our extra action's time, add a tick to the max action time.
                        time: [maxActionTime[0], maxActionTime[1] + 1],
                        taskId: transactionEntry.taskItem.taskId,
                        taskAction: {
                            type: "UpdateChildrenCounts",
                            addedChildTaskCount: transactionEntry.taskItem.addedChildTaskCount,
                            removedChildTaskCount: transactionEntry.taskItem.removedChildTaskCount,
                            addedClosedChildTaskCount:
                                transactionEntry.taskItem.addedClosedChildTaskCount,
                            removedClosedChildTaskCount:
                                transactionEntry.taskItem.removedClosedChildTaskCount,
                        },
                    });
                }
            }

            for (const transactionEntry of state._transactionEntryByCollectionId.values()) {
                switch (transactionEntry.action) {
                    case "CreateItem": {
                        transactionEntries.push(
                            TaskTable.transactionCreateItem(transactionEntry.collectionItem),
                        );
                        break;
                    }
                    case "DirectlyUpdateItem": {
                        transactionEntries.push(
                            TaskTable.transactionDirectlyUpdateItem(
                                transactionEntry.collectionItem,
                            ),
                        );
                        break;
                    }
                    default:
                        throw exhaustive(transactionEntry.action);
                }
            }

            if (state._actorNotepadItemTransactionEntry) {
                transactionEntries.push(
                    TaskTable.transactionDirectlyUpdateItem(
                        state._actorNotepadItemTransactionEntry,
                    ),
                );
            }

            await commitTaskActionTransactionBeforeExecuteTestCheckpoint.waitForTest(
                context.actor.getAccountId(),
            );

            const actionTransactionItem: TaskActionTransactionItem = {
                partitionType: "TaskActions",
                sortRangeType: "ActionTransaction",
                spaceId,
                committedTime: new Date(),
                actionTransactionId: generateId<TaskActionTransactionId>(),
                actions: [...actions, ...extraActions],
                wasProcessed: false,
            };

            if (transactionEntries.length > 0) {
                transactionEntries.push(
                    TaskActionTable.transactionCreateOrReplaceItem(actionTransactionItem),
                );

                await DynamoTableSchema.executeTransaction(context, transactionEntries);
            } else {
                await TaskActionTable.createOrReplaceItem(context, actionTransactionItem);
            }

            return {
                actionTransactionItem,
                extraActions,
            };
        });
    }

    public getActorAccountId(): AccountId {
        return this._context.actor.getAccountId();
    }

    public isAccountMemberOfSpace(accountId: AccountId): Promise<boolean> {
        return isAccountMemberOfSpace(this._context, this._spaceId, accountId);
    }

    /**
     * Clients specify change times for various properties and we use change times
     * to resolve conflicting updates. Clients may specify a change time at any
     * point in the past (maybe they are syncing offline updates) but they may not
     * specify a change time too far in the future.
     *
     * We provide some wiggle room to account for clock skew. It's recommended that
     * clients use NTP to get a time (through our `/api/time` route implemented in
     * `EdgeService`) that's consistent with other clients instead of relying on
     * the device clock.
     */
    public isTimeReasonable(time: number): boolean {
        return time - this._startTime < 1000 * 60 * 2;
    }

    public getTaskItemIfExists(taskId: TaskId): Promise<TaskEssentialAttributesItem | null> {
        return getOrSetDefaultMapValue(this._taskItemById, taskId, async () => {
            const taskItem = await TaskTable.getItemIfExists(this._context, {
                partitionType: "Task",
                sortRangeType: "EssentialAttributes",
                taskId,
            });
            if (!taskItem) return null;

            if (taskItem.spaceId !== this._spaceId)
                throw new FailedPreconditionError("Space mismatch");

            return taskItem;
        });
    }

    public async getTaskItem(taskId: TaskId): Promise<TaskEssentialAttributesItem> {
        const taskItem = await this.getTaskItemIfExists(taskId);

        // Internal error since we should keep a record of even deleted tasks.
        if (!taskItem) throw new InternalError("Task not found");

        return taskItem;
    }

    public createTaskItem(taskItem: TaskEssentialAttributesItem) {
        this._taskItemById.set(taskItem.taskId, Promise.resolve(taskItem));

        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByTaskId,
            taskItem.taskId,
            () => ({
                action: "CreateItem" as const,
                taskItem,
                shouldCommitExtraUpdateChildrenCountAction: false,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
                break;
            case "DirectlyUpdateItem":
            case "DirectlyUpdateItemLockVersion":
                throw new FailedPreconditionError("Can't update a task before it's created");
            default:
                throw exhaustive(transactionEntry.action);
        }

        if (transactionEntry.taskItem.updateLockVersion !== taskItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.taskItem = taskItem;
    }

    public updateTaskItem(
        taskItem: TaskEssentialAttributesItem,
        {
            shouldCommitExtraUpdateChildrenCountAction = false,
        }: {
            // If set to true then we will add an `UpdateChildrenCount` action to the end
            // of the current transaction before committing.
            shouldCommitExtraUpdateChildrenCountAction?: boolean;
        } = {},
    ) {
        this._taskItemById.set(taskItem.taskId, Promise.resolve(taskItem));

        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByTaskId,
            taskItem.taskId,
            () => ({
                action: "DirectlyUpdateItem" as const,
                taskItem,
                shouldCommitExtraUpdateChildrenCountAction: false,
            }),
        );

        transactionEntry.shouldCommitExtraUpdateChildrenCountAction ||=
            shouldCommitExtraUpdateChildrenCountAction;

        switch (transactionEntry.action) {
            case "CreateItem":
            case "DirectlyUpdateItem":
                break;
            case "DirectlyUpdateItemLockVersion":
                transactionEntry.action = "DirectlyUpdateItem";
                break;
            default:
                throw exhaustive(transactionEntry.action);
        }

        if (transactionEntry.taskItem.updateLockVersion !== taskItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.taskItem = taskItem;
    }

    public updateTaskItemLockVersion(taskItem: TaskEssentialAttributesItem) {
        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByTaskId,
            taskItem.taskId,
            () => ({
                action: "DirectlyUpdateItemLockVersion" as const,
                taskItem,
                shouldCommitExtraUpdateChildrenCountAction: false,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
            case "DirectlyUpdateItem":
            case "DirectlyUpdateItemLockVersion":
                break;
            default:
                throw exhaustive(transactionEntry.action);
        }

        if (transactionEntry.taskItem.updateLockVersion !== taskItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.taskItem = taskItem;
    }

    public getCollectionItemIfExists(
        collectionId: TaskCollectionId,
    ): Promise<TaskCollectionEssentialAttributesItem | null> {
        return getOrSetDefaultMapValue(this._collectionItemById, collectionId, async () => {
            const collectionItem = await TaskTable.getItemIfExists(this._context, {
                partitionType: "TaskCollection",
                sortRangeType: "EssentialAttributes",
                collectionId,
            });
            if (!collectionItem) return null;

            if (collectionItem.spaceId !== this._spaceId)
                throw new FailedPreconditionError("Space mismatch");

            return collectionItem;
        });
    }

    public async getCollectionItem(
        collectionId: TaskCollectionId,
    ): Promise<TaskCollectionEssentialAttributesItem> {
        const collectionItem = await this.getCollectionItemIfExists(collectionId);

        // Internal error since we should keep a record of even deleted tasks.
        if (!collectionItem) throw new InternalError("Task collection not found");

        return collectionItem;
    }

    public createCollectionItem(collectionItem: TaskCollectionEssentialAttributesItem) {
        this._collectionItemById.set(collectionItem.collectionId, Promise.resolve(collectionItem));

        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByCollectionId,
            collectionItem.collectionId,
            () => ({
                collectionItem,
                action: "CreateItem" as const,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
                break;
            case "DirectlyUpdateItem":
                throw new FailedPreconditionError("Can't update a collection before it's created");
            default:
                throw exhaustive(transactionEntry.action);
        }

        if (transactionEntry.collectionItem.updateLockVersion !== collectionItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.collectionItem = collectionItem;
    }

    public updateCollectionItem(collectionItem: TaskCollectionEssentialAttributesItem) {
        this._collectionItemById.set(collectionItem.collectionId, Promise.resolve(collectionItem));

        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByCollectionId,
            collectionItem.collectionId,
            () => ({
                collectionItem,
                action: "DirectlyUpdateItem" as const,
            }),
        );

        switch (transactionEntry.action) {
            case "CreateItem":
            case "DirectlyUpdateItem":
                break;
            default:
                throw exhaustive(transactionEntry.action);
        }

        if (transactionEntry.collectionItem.updateLockVersion !== collectionItem.updateLockVersion)
            throw new InternalError(
                "`updateLockVersion` should only change after we commit to the database",
            );

        transactionEntry.collectionItem = collectionItem;
    }

    public getActorNotepadItem(): Promise<TaskAccountNotepadItem> {
        if (this._actorNotepadItemPromise === null) {
            this._actorNotepadItemPromise = (async () => {
                let notepadPagesItem = await TaskTable.getItemIfExists(this._context, {
                    partitionType: "Account",
                    sortRangeType: "Notepad",
                    accountId: this._context.actor.getAccountId(),
                    spaceId: this._spaceId,
                });

                notepadPagesItem ??= {
                    partitionType: "Account",
                    sortRangeType: "Notepad",
                    accountId: this._context.actor.getAccountId(),
                    spaceId: this._spaceId,
                    pageIds: TaskNotepadPageIdCompressedSet.fromIds(new Set()),
                };

                return notepadPagesItem;
            })();
        }

        return this._actorNotepadItemPromise;
    }

    public updateActorNotepadItem(notepadItem: TaskAccountNotepadItem) {
        assert(notepadItem.accountId === this._context.actor.getAccountId());
        assert(notepadItem.spaceId === this._spaceId);

        this._actorNotepadItemPromise = Promise.resolve(notepadItem);
        this._actorNotepadItemTransactionEntry = notepadItem;
    }

    public evaluateCollectionAccessPolicy(
        accessPolicy: TaskCollectionAccessPolicy,
        expectedAccessLevel: TaskCollectionAccessLevel,
    ) {
        return evaluateTaskCollectionAccessPolicy(
            this._context,
            this._context.actor.getAccountId(),
            this._spaceId,
            accessPolicy,
            expectedAccessLevel,
        );
    }

    public async authorizeCollectionAccess(
        collectionId: TaskCollectionId,
        expectedAccessLevel: TaskCollectionAccessLevel,
    ) {
        const collectionItem = await this.getCollectionItem(collectionId);

        const hasAccess = await isTaskCollectionItemAccessAuthorized(
            this._context,
            this._context.actor.getAccountId(),
            collectionItem,
            expectedAccessLevel,
        );

        if (!hasAccess) {
            throw new PermissionDeniedError(
                quote`Actor does not have ${expectedAccessLevel} access level to task collection`,
            );
        }
    }

    public async authorizeCollectionAccessAllowingDeletedCollections(
        collectionId: TaskCollectionId,
        expectedAccessLevel: TaskCollectionAccessLevel,
    ) {
        const collectionItem = await this.getCollectionItem(collectionId);

        const hasAccess = await isTaskCollectionItemAccessAuthorizedAllowingDeletedTasks(
            this._context,
            this._context.actor.getAccountId(),
            collectionItem,
            expectedAccessLevel,
        );

        if (!hasAccess) {
            throw new PermissionDeniedError(
                quote`Actor does not have ${expectedAccessLevel} access level to task collection`,
            );
        }
    }

    public async authorizeTaskItemAccess(
        taskItem: TaskEssentialAttributesItem,
        expectedAccessLevel: TaskCollectionAccessLevel,
    ) {
        const hasAccess = await isTaskItemAccessAuthorized(
            this._context,
            this._context.actor.getAccountId(),
            taskItem,
            expectedAccessLevel,
            this,
        );

        if (!hasAccess) {
            throw new PermissionDeniedError(
                quote`Actor does not have ${expectedAccessLevel} access level to task`,
            );
        }
    }

    public async authorizeTaskItemAccessAllowingDeletedTasks(
        taskItem: TaskEssentialAttributesItem,
        expectedAccessLevel: TaskCollectionAccessLevel,
    ) {
        const hasAccess = await isTaskItemAccessAuthorizedAllowingDeletedTasks(
            this._context,
            this._context.actor.getAccountId(),
            taskItem,
            expectedAccessLevel,
            this,
        );

        if (!hasAccess) {
            throw new PermissionDeniedError(
                quote`Actor does not have ${expectedAccessLevel} access level to task`,
            );
        }
    }
}

const circularTaskDependencyErrorDisplayMessage = errorDisplayMessage`Can’t move a task to the subtasks of one of its own subtasks. Check your task’s subtasks and try removing the one you want to move your task into.`;

async function actuallyCommitTaskActionTransaction(
    // We intentionally don't pass in `context` since we want all DynamoDB access
    // to go through this `state` object. That way we force reads to go through our
    // local cache.
    state: TaskActionTransactionCommitState,
    spaceId: SpaceId,
    actionTransaction: ReadonlyArray<TaskAction>,
) {
    for (const action of actionTransaction) {
        // Make sure our action time isn't too far in the future. That would mean
        // future updates all need to use the `ticks` property of `HybridLogicalTime`
        // and couldn't express the update time with a real time.
        if (!state.isTimeReasonable(action.time[0])) {
            throw new InvalidArgumentError("Action time too far in the future");
        }

        switch (action.type) {
            case "UpdateTask": {
                const {taskId, taskAction} = action;

                switch (taskAction.type) {
                    case "Create": {
                        if (taskAction.creator.accountId !== state.getActorAccountId()) {
                            throw new PermissionDeniedError(
                                "Can only create a task with yourself as the creator",
                            );
                        }

                        state.createTaskItem({
                            partitionType: "Task",
                            sortRangeType: "EssentialAttributes",
                            taskId,
                            spaceId,
                            creatorId: taskAction.creator.accountId,
                            createdTime: action.time,
                            deletedTime: null,
                            statusType: new TaskStatusTypeRegister("Open", action.time),
                            parentTaskId: new TaskParentTaskIdRegister(null, action.time),
                            addedChildTaskCount: 0,
                            removedChildTaskCount: 0,
                            addedClosedChildTaskCount: 0,
                            removedClosedChildTaskCount: 0,
                            childTaskIds: new Set(),
                            collections: TaskCollectionSet.empty,
                            assigneeId: new TaskAssigneeAccountIdRegister(null, action.time),
                        });
                        break;
                    }
                    case "Undelete": {
                        const taskItem = await state.getTaskItemIfExists(taskId);
                        if (!taskItem) throw new NotFoundError("Task not found");
                        if (!taskItem.deletedTime)
                            throw new FailedPreconditionError("Expected task to be deleted");

                        await state.authorizeTaskItemAccessAllowingDeletedTasks(taskItem, "Edit");

                        if (compareHybridLogicalTimes(action.time, taskItem.deletedTime) <= 0) {
                            throw new FailedPreconditionError(
                                "Undelete action time is less than delete action time",
                            );
                        }

                        const seenTaskIds = new Set([taskItem.taskId]);
                        let currentParentTaskItem = taskItem;

                        while (currentParentTaskItem.parentTaskId.value !== null) {
                            // We don't allow task circular dependencies which would cause infinite
                            // looping. Deleted tasks break the circular dependency chain. So a circular
                            // dependency may exist involving a deleted task. When we undelete, we need to
                            // make sure it doesn't create a circular dependency.
                            if (seenTaskIds.has(currentParentTaskItem.parentTaskId.value)) {
                                throw new FailedPreconditionError(
                                    "Undeleting task would create a circular dependency",
                                    {
                                        // NOTE(calebmer): Ideally the error message would have a hint. This error case
                                        // seems pretty rare. I'd want to know what the UI of this looks like to write
                                        // an appropriate hint. (e.g. Can you see the old parent task?)
                                        displayMessage: errorDisplayMessage`Undoing task deletion would make the task its own subtask.`,
                                    },
                                );
                            }

                            const nextParentTaskItem = await state.getTaskItem(
                                currentParentTaskItem.parentTaskId.value,
                            );

                            // Deleted tasks do not participate in circular dependencies.
                            if (nextParentTaskItem.deletedTime) break;

                            seenTaskIds.add(nextParentTaskItem.taskId);
                            currentParentTaskItem = nextParentTaskItem;
                        }

                        // Force updates to a root task's subtask tree to be serialized. That way race
                        // conditions can't sneak a circular dependency in.
                        state.updateTaskItemLockVersion(currentParentTaskItem);

                        state.updateTaskItem({
                            ...taskItem,
                            deletedTime: null,
                        });

                        if (taskItem.parentTaskId.value !== null) {
                            // May be cached from authorization...
                            const parentTaskItem = await state.getTaskItem(
                                taskItem.parentTaskId.value,
                            );

                            state.updateTaskItem(
                                {
                                    ...parentTaskItem,
                                    addedChildTaskCount: parentTaskItem.addedChildTaskCount + 1,
                                    addedClosedChildTaskCount:
                                        parentTaskItem.addedClosedChildTaskCount +
                                        (taskItem.statusType.value === "Closed" ? 1 : 0),
                                },
                                {shouldCommitExtraUpdateChildrenCountAction: true},
                            );
                        }
                        break;
                    }
                    default: {
                        const taskItem = await state.getTaskItemIfExists(taskId);
                        if (!taskItem) throw new NotFoundError("Task not found");
                        if (taskItem.deletedTime)
                            throw new FailedPreconditionError("Task was deleted");

                        await state.authorizeTaskItemAccess(taskItem, "Edit");

                        switch (taskAction.type) {
                            case "Delete": {
                                if (
                                    compareHybridLogicalTimes(action.time, taskItem.createdTime) <=
                                    0
                                ) {
                                    throw new FailedPreconditionError(
                                        "Delete action time is less than create action time",
                                    );
                                }

                                state.updateTaskItem({
                                    ...taskItem,
                                    deletedTime: action.time,
                                });

                                if (taskItem.parentTaskId.value !== null) {
                                    // May be cached from authorization...
                                    const parentTaskItem = await state.getTaskItem(
                                        taskItem.parentTaskId.value,
                                    );

                                    state.updateTaskItem(
                                        {
                                            ...parentTaskItem,
                                            removedChildTaskCount:
                                                parentTaskItem.removedChildTaskCount + 1,
                                            removedClosedChildTaskCount:
                                                parentTaskItem.removedClosedChildTaskCount +
                                                (taskItem.statusType.value === "Closed" ? 1 : 0),
                                        },
                                        {shouldCommitExtraUpdateChildrenCountAction: true},
                                    );
                                }
                                break;
                            }
                            case "UpdateParentTaskId": {
                                // We want to prevent the creation of cycles even during race conditions. So we
                                // call `updateTaskItemLockVersion()` on critical parent tasks that can't
                                // update without us knowing about it. We call this method on:
                                //
                                // 1. The root parent task in the new parent task chain
                                // 2. The root parent task in the old parent task chain
                                //
                                // This has the effect of forcing any change to subtask structure under a root
                                // task to be committed serially. If the root task itself is made the subtask
                                // of some other task than that update too must be serialized with changes to
                                // its subtask structure. By serializing updates to subtask structure we can
                                // make sure no circular dependencies are introduced.
                                await runAllPromiseThunks(
                                    // Authorize new parent `TaskId`:
                                    async () => {
                                        if (taskAction.parentTaskId === null) return;

                                        if (taskId === taskAction.parentTaskId) {
                                            throw new FailedPreconditionError(
                                                "Updating task's `parentTaskId` would create a circular dependency",
                                                {
                                                    displayMessage:
                                                        circularTaskDependencyErrorDisplayMessage,
                                                },
                                            );
                                        }

                                        const newParentTaskItem = await state.getTaskItemIfExists(
                                            taskAction.parentTaskId,
                                        );
                                        if (!newParentTaskItem)
                                            throw new NotFoundError("Parent task not found");
                                        if (newParentTaskItem.deletedTime)
                                            throw new FailedPreconditionError(
                                                "Parent task is deleted",
                                            );

                                        // Make sure we have edit access to the parent task in order to make this task
                                        // a child of it.
                                        await state.authorizeTaskItemAccess(
                                            newParentTaskItem,
                                            "Edit",
                                        );

                                        const seenTaskIds = new Set([
                                            taskId,
                                            newParentTaskItem.taskId,
                                        ]);
                                        let currentNewParentTaskItem = newParentTaskItem;

                                        while (
                                            currentNewParentTaskItem.parentTaskId.value !== null
                                        ) {
                                            // We don't allow task circular dependencies which would cause infinite
                                            // looping. If we see that updating our `parentTaskId` would create a circular
                                            // dependency then error.
                                            if (
                                                seenTaskIds.has(
                                                    currentNewParentTaskItem.parentTaskId.value,
                                                )
                                            ) {
                                                throw new FailedPreconditionError(
                                                    "Updating task's `parentTaskId` would create a circular dependency",
                                                    {
                                                        displayMessage:
                                                            circularTaskDependencyErrorDisplayMessage,
                                                    },
                                                );
                                            }

                                            // Parent task loading may be cached by our `authorizeTaskItemAccess()`
                                            // call earlier.
                                            const nextNewParentTaskItem = await state.getTaskItem(
                                                currentNewParentTaskItem.parentTaskId.value,
                                            );

                                            // Deleted tasks do not participate in circular dependencies.
                                            if (nextNewParentTaskItem.deletedTime) break;

                                            seenTaskIds.add(nextNewParentTaskItem.taskId);
                                            currentNewParentTaskItem = nextNewParentTaskItem;
                                        }

                                        // Force updates to a root task's subtask tree to be serialized. That way race
                                        // conditions can't sneak a circular dependency in.
                                        state.updateTaskItemLockVersion(currentNewParentTaskItem);
                                    },
                                    // Authorize old parent `TaskId`:
                                    async () => {
                                        if (taskItem.parentTaskId.value === null) return;

                                        const oldParentTaskItem = await state.getTaskItem(
                                            taskItem.parentTaskId.value,
                                        );
                                        if (oldParentTaskItem.deletedTime) return;

                                        // We allow you to change the parent of a task you have edit access to even if
                                        // you don't have access to the _current_ parent task. This is because we also
                                        // allow you to delete tasks even when you don't have access to the current
                                        // parent task. That operation will remove a child task from a parent task so
                                        // it follows a user is allowed to remove tasks they have access to from
                                        // unknown parents.
                                        //
                                        // Should we allow deleting a task when you don't have access to the parent?
                                        // Arguably not. But it's hard to explain a restriction like that in the UI and
                                        // the restriction is not too bad if we explain it in the revision feed.
                                        //
                                        // NOCOMMIT: Deleting or changing the parent of a child task should add a
                                        // revision history entry to the parent task.

                                        let currentOldParentTaskItem = oldParentTaskItem;

                                        while (
                                            currentOldParentTaskItem.parentTaskId.value !== null
                                        ) {
                                            const nextOldParentTaskItem = await state.getTaskItem(
                                                currentOldParentTaskItem.parentTaskId.value,
                                            );

                                            // Deleted tasks do not participate in circular dependencies.
                                            if (nextOldParentTaskItem.deletedTime) break;

                                            currentOldParentTaskItem = nextOldParentTaskItem;
                                        }

                                        // Force updates to a root task's subtask tree to be serialized. That way race
                                        // conditions can't sneak a circular dependency in.
                                        state.updateTaskItemLockVersion(currentOldParentTaskItem);
                                    },
                                );

                                const oldParentTaskId = taskItem.parentTaskId;
                                const newParentTaskId = oldParentTaskId.apply({
                                    value: taskAction.parentTaskId,
                                    version: action.time,
                                });

                                state.updateTaskItem({
                                    ...taskItem,
                                    parentTaskId: newParentTaskId.apply({
                                        value: taskAction.parentTaskId,
                                        version: action.time,
                                    }),
                                });

                                // If the parent task changed then increment our counters such that we remove
                                // our task from the old parent and add our task to the new parent.
                                if (oldParentTaskId.value !== newParentTaskId.value) {
                                    await runAllPromiseThunks(
                                        async () => {
                                            if (oldParentTaskId.value === null) return;

                                            // Should be cached from authorization...
                                            const oldParentTaskItem = await state.getTaskItem(
                                                oldParentTaskId.value,
                                            );

                                            const oldParentChildTaskIds = new Set(
                                                oldParentTaskItem.childTaskIds,
                                            );
                                            oldParentChildTaskIds.delete(taskItem.taskId);

                                            state.updateTaskItem(
                                                {
                                                    ...oldParentTaskItem,
                                                    removedChildTaskCount:
                                                        oldParentTaskItem.removedChildTaskCount + 1,
                                                    removedClosedChildTaskCount:
                                                        oldParentTaskItem.removedClosedChildTaskCount +
                                                        (taskItem.statusType.value === "Closed"
                                                            ? 1
                                                            : 0),
                                                    childTaskIds: oldParentChildTaskIds,
                                                },
                                                {shouldCommitExtraUpdateChildrenCountAction: true},
                                            );
                                        },
                                        async () => {
                                            if (newParentTaskId.value === null) return;

                                            // Should be cached from authorization...
                                            const newParentTaskItem = await state.getTaskItem(
                                                newParentTaskId.value,
                                            );

                                            const newParentChildTaskIds = new Set(
                                                newParentTaskItem.childTaskIds,
                                            );
                                            newParentChildTaskIds.add(taskItem.taskId);

                                            state.updateTaskItem(
                                                {
                                                    ...newParentTaskItem,
                                                    addedChildTaskCount:
                                                        newParentTaskItem.addedChildTaskCount + 1,
                                                    addedClosedChildTaskCount:
                                                        newParentTaskItem.addedClosedChildTaskCount +
                                                        (taskItem.statusType.value === "Closed"
                                                            ? 1
                                                            : 0),
                                                    childTaskIds: newParentChildTaskIds,
                                                },
                                                {shouldCommitExtraUpdateChildrenCountAction: true},
                                            );
                                        },
                                    );
                                }
                                break;
                            }
                            case "UpdateParentPosition": {
                                if (
                                    !state.isTimeReasonable(taskAction.parentPosition.orderTime[0])
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                if (taskItem.parentTaskId.value === null) {
                                    throw new FailedPreconditionError(
                                        "Task does not have a parent",
                                    );
                                }

                                const parentTaskItem = await state.getTaskItem(
                                    taskItem.parentTaskId.value,
                                );
                                if (parentTaskItem.deletedTime)
                                    throw new FailedPreconditionError("Parent task is deleted");

                                // Make sure we have edit access to the parent task. The order key is more-so a
                                // property of the parent task than it is a property of our task.
                                await state.authorizeTaskItemAccess(parentTaskItem, "Edit");
                                break;
                            }
                            case "UpdateChildrenCounts": {
                                // These actions may only be generated by the server.
                                //
                                // See the documentation on `TaskUpdateChildrenCountsAction` for more
                                // information on why this isn't allowed.
                                throw new InvalidArgumentError(
                                    "Clients are not allowed to commit an `UpdateChildrenCounts` action",
                                );
                            }
                            case "AddCollection": {
                                // If you have collection edit access then you implicitly also have task edit
                                // access.
                                await state.authorizeCollectionAccess(
                                    taskAction.collectionId,
                                    "Edit",
                                );

                                state.updateTaskItem({
                                    ...taskItem,
                                    collections: taskItem.collections.apply({
                                        type: "Set",
                                        key: taskAction.collectionId,
                                        value: taskAction.orderKey,
                                        version: action.time,
                                    }),
                                });
                                break;
                            }
                            case "RemoveCollection": {
                                // If you have collection edit access then you implicitly also have task edit
                                // access.
                                await state.authorizeCollectionAccess(
                                    taskAction.collectionId,
                                    "Edit",
                                );

                                state.updateTaskItem({
                                    ...taskItem,
                                    collections: taskItem.collections.apply({
                                        type: "Delete",
                                        key: taskAction.collectionId,
                                        version: action.time,
                                    }),
                                });
                                break;
                            }
                            case "UpdateCollectionPosition": {
                                if (!state.isTimeReasonable(taskAction.position.orderTime[0])) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                if (!taskItem.collections.has(taskAction.collectionId)) {
                                    throw new FailedPreconditionError("Task is not in collection");
                                }

                                // If you have collection edit access then you implicitly also have task edit
                                // access.
                                await state.authorizeCollectionAccess(
                                    taskAction.collectionId,
                                    "Edit",
                                );
                                break;
                            }
                            case "UpdateNotepadPagePosition": {
                                if (
                                    taskAction.position &&
                                    !state.isTimeReasonable(taskAction.position.orderTime[0])
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                if (taskAction.accountId !== state.getActorAccountId()) {
                                    throw new PermissionDeniedError(
                                        "Can only access your account's notepad",
                                    );
                                }

                                if (taskItem.creatorId !== state.getActorAccountId()) {
                                    throw new PermissionDeniedError(
                                        "Can only add tasks you created to your account's notepad",
                                    );
                                }
                                break;
                            }
                            case "UpdateStatus": {
                                if (
                                    taskAction.status.type === "Closed" &&
                                    !state.isTimeReasonable(
                                        taskAction.status.closedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `closedTime` is too far in the future",
                                    );
                                }

                                if (
                                    taskAction.status.type === "Closed" &&
                                    taskAction.status.closer.accountId !== state.getActorAccountId()
                                ) {
                                    throw new PermissionDeniedError(
                                        "Can only close a task with yourself as the closer",
                                    );
                                }

                                const oldStatusType = taskItem.statusType;

                                const newStatusType = oldStatusType.apply({
                                    value: taskAction.status.type,
                                    version: action.time,
                                });

                                state.updateTaskItem({
                                    ...taskItem,
                                    statusType: newStatusType,
                                });

                                if (taskItem.parentTaskId.value !== null) {
                                    if (
                                        oldStatusType.value !== "Closed" &&
                                        newStatusType.value === "Closed"
                                    ) {
                                        // May be cached from authorization...
                                        const parentTaskItem = await state.getTaskItem(
                                            taskItem.parentTaskId.value,
                                        );

                                        state.updateTaskItem(
                                            {
                                                ...parentTaskItem,
                                                addedClosedChildTaskCount:
                                                    parentTaskItem.addedClosedChildTaskCount + 1,
                                            },
                                            {shouldCommitExtraUpdateChildrenCountAction: true},
                                        );
                                    }

                                    if (
                                        oldStatusType.value === "Closed" &&
                                        newStatusType.value !== "Closed"
                                    ) {
                                        // May be cached from authorization...
                                        const parentTaskItem = await state.getTaskItem(
                                            taskItem.parentTaskId.value,
                                        );

                                        state.updateTaskItem(
                                            {
                                                ...parentTaskItem,
                                                removedClosedChildTaskCount:
                                                    parentTaskItem.removedClosedChildTaskCount + 1,
                                            },
                                            {shouldCommitExtraUpdateChildrenCountAction: true},
                                        );
                                    }
                                }
                                break;
                            }
                            case "UpdateAssignee": {
                                if (
                                    taskAction.assignee &&
                                    !state.isTimeReasonable(
                                        taskAction.assignee.assignedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `assignedTime` is too far in the future",
                                    );
                                }

                                if (
                                    taskAction.assignee &&
                                    taskAction.assignee.assigner.accountId !==
                                        state.getActorAccountId()
                                ) {
                                    throw new PermissionDeniedError(
                                        "Can only assign a task with yourself as the assigner",
                                    );
                                }

                                if (
                                    taskAction.assignee &&
                                    !(await state.isAccountMemberOfSpace(
                                        taskAction.assignee.assignee.accountId,
                                    ))
                                ) {
                                    throw new FailedPreconditionError(
                                        "Can't assign a task to an account outside of the current space",
                                    );
                                }

                                state.updateTaskItem({
                                    ...taskItem,
                                    assigneeId: taskItem.assigneeId.apply({
                                        value: taskAction.assignee?.assignee.accountId ?? null,
                                        version: action.time,
                                    }),
                                });
                                break;
                            }
                            case "UpdateAssigneeStatus": {
                                if (
                                    taskAction.assigneeStatus.type === "Active" &&
                                    !state.isTimeReasonable(
                                        taskAction.assigneeStatus.activatedTime.absoluteTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `activatedTime` is too far in the future",
                                    );
                                }
                                break;
                            }
                            case "UpdateAssigneeActivePosition": {
                                if (!state.isTimeReasonable(taskAction.position.orderTime[0])) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                if (taskItem.assigneeId.value !== state.getActorAccountId()) {
                                    throw new PermissionDeniedError(
                                        "Can only update the task's active position if you are the task's assignee",
                                    );
                                }

                                if (taskAction.accountId !== state.getActorAccountId()) {
                                    throw new PermissionDeniedError(
                                        "Must use the actor `AccountId` when updating the task's active position",
                                    );
                                }
                                break;
                            }
                            case "UpdateTitle": {
                                // Y.js uses Lamport timestamps which we don't need to validate for
                                // reasonableness.
                                break;
                            }
                            case "UpdateDueDate": {
                                // We don't store due date in essential attributes and action time
                                // is validated above.
                                break;
                            }
                            case "UpdatePriority": {
                                // We don't store priority in essential attributes and action time
                                // is validated above.
                                break;
                            }
                            default:
                                throw exhaustive(taskAction);
                        }
                    }
                }
                break;
            }
            case "UpdateCollection": {
                const {collectionId, collectionAction} = action;

                switch (collectionAction.type) {
                    case "Create": {
                        const newCollectionItem: TaskCollectionEssentialAttributesItem = {
                            partitionType: "TaskCollection",
                            sortRangeType: "EssentialAttributes",
                            collectionId,
                            spaceId,
                            createdTime: action.time,
                            deletedTime: null,
                            accessPolicy: new TaskCollectionAccessPolicyRegister(
                                collectionAction.accessPolicy,
                                action.time,
                            ),
                        };

                        if (
                            !(await state.evaluateCollectionAccessPolicy(
                                newCollectionItem.accessPolicy.value,
                                "Manage",
                            ))
                        ) {
                            throw new InvalidArgumentError(
                                'Must have the "Manage" access level on a collection you create',
                            );
                        }

                        state.createCollectionItem(newCollectionItem);
                        break;
                    }
                    case "Undelete": {
                        const collectionItem = await state.getCollectionItemIfExists(collectionId);
                        if (!collectionItem) throw new NotFoundError("Task collection not found");
                        if (!collectionItem.deletedTime)
                            throw new FailedPreconditionError("Expected task to be deleted");

                        await state.authorizeCollectionAccessAllowingDeletedCollections(
                            collectionId,
                            "Manage",
                        );

                        if (
                            compareHybridLogicalTimes(action.time, collectionItem.deletedTime) <= 0
                        ) {
                            throw new FailedPreconditionError(
                                "Undelete action time is less than delete action time",
                            );
                        }

                        state.updateCollectionItem({
                            ...collectionItem,
                            deletedTime: null,
                        });
                        break;
                    }
                    default: {
                        const collectionItem = await state.getCollectionItemIfExists(collectionId);
                        if (!collectionItem) throw new NotFoundError("Task collection not found");
                        if (collectionItem.deletedTime)
                            throw new FailedPreconditionError("Task collection was deleted");

                        switch (collectionAction.type) {
                            case "Delete": {
                                if (
                                    compareHybridLogicalTimes(
                                        action.time,
                                        collectionItem.createdTime,
                                    ) <= 0
                                ) {
                                    throw new FailedPreconditionError(
                                        "Delete action time is less than create action time",
                                    );
                                }

                                await state.authorizeCollectionAccess(collectionId, "Manage");

                                state.updateCollectionItem({
                                    ...collectionItem,
                                    deletedTime: action.time,
                                });
                                break;
                            }
                            case "UpdateName": {
                                await state.authorizeCollectionAccess(collectionId, "Manage");
                                break;
                            }
                            case "UpdateAccessPolicy": {
                                if (
                                    iterableEvery(
                                        collectionAction.accessPolicy.accountGrantById.values(),
                                        grant =>
                                            !hasTaskCollectionAccessLevel(grant.level, "Manage"),
                                    ) &&
                                    (collectionAction.accessPolicy.defaultGrant?.type !== "Space" ||
                                        !hasTaskCollectionAccessLevel(
                                            collectionAction.accessPolicy.defaultGrant.level,
                                            "Manage",
                                        ))
                                ) {
                                    throw new InvalidArgumentError(
                                        '`accessPolicy` must grant at least one account the "Manage" access level',
                                    );
                                }

                                await state.authorizeCollectionAccess(collectionId, "Manage");

                                state.updateCollectionItem({
                                    ...collectionItem,
                                    accessPolicy: collectionItem.accessPolicy.apply({
                                        value: collectionAction.accessPolicy,
                                        version: action.time,
                                    }),
                                });
                                break;
                            }
                            default:
                                throw exhaustive(collectionAction);
                        }
                        break;
                    }
                }
                break;
            }
            case "UpdateNotepadPage": {
                const {notepadPageId, notepadPageAction} = action;

                if (action.accountId !== state.getActorAccountId())
                    throw new PermissionDeniedError("Can only access your account's notepad");

                const notepadItem = await state.getActorNotepadItem();

                cast<"Create">(notepadPageAction.type);

                if (notepadItem.pageIds.getIds().has(notepadPageId))
                    throw new FailedPreconditionError("Notepad page already exists");

                const newPageIds = new Set(notepadItem.pageIds.getIds());
                newPageIds.add(notepadPageId);

                state.updateActorNotepadItem({
                    ...notepadItem,
                    pageIds: TaskNotepadPageIdCompressedSet.fromIds(newPageIds),
                });
                break;
            }
            default:
                throw exhaustive(action);
        }
    }
}

export const deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint = new TestCheckpoint<AccountId>();

/**
 * Delete the provided `TaskId` and all children of that task in a single
 * transaction. Returns the actions we committed from this function call.
 *
 * On the client we may not know all the transitive children of a task. So this
 * functionality needs to be implemented on the server.
 */
export function deleteTaskAndAllChildren(
    context: Context<ServerSessionActionContextModules & {tasks: TaskContextModuleBase}>,
    taskId: TaskId,
    actionTime: HybridLogicalTime,
): Promise<{
    spaceId: SpaceId;
    actions: ReadonlyArray<TaskAction>;
}> {
    let hasAlreadyAttempted = false;

    return context.dynamo.retryTransaction(async context => {
        const isInitialAttempt = !hasAlreadyAttempted;
        hasAlreadyAttempted = true;

        const taskItem = await TaskTable.getItem(context, {
            partitionType: "Task",
            sortRangeType: "EssentialAttributes",
            taskId,
        });

        await authorizeTaskItemAccess(context, taskItem, "Edit", null);

        let rootParentTaskItem: TaskEssentialAttributesItem = taskItem;
        let parentTaskItem: TaskEssentialAttributesItem | null = null;
        while (rootParentTaskItem.parentTaskId.value) {
            const parentTaskId = rootParentTaskItem.parentTaskId.value;

            // Use `getTaskItemForAuthorization` since it will cache tasks seen during
            // our `authorizeTaskItemAccess` call. If we are retrying then we need to load
            // the latest version.
            rootParentTaskItem = isInitialAttempt
                ? await TaskItemAuthorizationCache.get(context, parentTaskId, () =>
                      TaskTable.getItem(context, {
                          partitionType: "Task",
                          sortRangeType: "EssentialAttributes",
                          taskId: parentTaskId,
                      }),
                  )
                : await TaskTable.getItem(context, {
                      partitionType: "Task",
                      sortRangeType: "EssentialAttributes",
                      taskId: parentTaskId,
                  });

            // We want to keep track of both the root parent task and the first
            // parent task.
            if (parentTaskItem === null) {
                parentTaskItem = rootParentTaskItem;
            }
        }

        const seenTaskIds = new Set([taskItem.taskId]);
        const updatedTaskItems: Array<{
            oldTaskItem: TaskEssentialAttributesItem;
            newTaskItem: TaskEssentialAttributesItem;
        }> = [];

        // Note that child tasks inherit the parent task's authorization.
        const addTaskItem = async (taskItem: TaskEssentialAttributesItem) => {
            const childTaskCount = taskItem.childTaskIds.size;
            let closedChildTaskCount = 0;

            await runAllPromises(
                Array.from(taskItem.childTaskIds, async childTaskId => {
                    const childTaskItem = await TaskTable.getItem(context, {
                        partitionType: "Task",
                        sortRangeType: "EssentialAttributes",
                        taskId: childTaskId,
                    });

                    if (childTaskItem.statusType.value === "Closed") {
                        closedChildTaskCount++;
                    }

                    // Keep track of `seenTaskIds` since while child tasks child be an acyclic tree
                    // where each node is unique, there may be concurrent task updates which cause
                    // us to observe something different.
                    if (seenTaskIds.has(childTaskItem.taskId)) return;

                    await addTaskItem(childTaskItem);
                }),
            );

            updatedTaskItems.push({
                oldTaskItem: taskItem,
                newTaskItem: {
                    ...taskItem,
                    deletedTime: actionTime,
                    removedChildTaskCount: taskItem.removedChildTaskCount + childTaskCount,
                    removedClosedChildTaskCount:
                        taskItem.removedClosedChildTaskCount + closedChildTaskCount,
                },
            });
        };

        await addTaskItem(taskItem);

        const transactionEntries: Array<DynamoTransactionEntry> = [];

        // Whenever we update a task's parent, we increment the `updateLockVersion` of
        // the root parent task. This way we can force updates to the child tree
        // structure to happen in sequence so we can validate there are no cycles.
        //
        // Force our recursive task deletion to be a part of this update sequence.
        if (
            rootParentTaskItem.taskId !== taskItem.taskId &&
            // We'll update `parentTaskItem` below so if it's the same as
            // `rootParentTaskItem` then we don't need to update `rootParentTaskItem`.
            rootParentTaskItem.taskId !== parentTaskItem?.taskId
        ) {
            transactionEntries.push(
                TaskTable.transactionDirectlyUpdateItemLockVersion(
                    rootParentTaskItem,
                    rootParentTaskItem.updateLockVersion,
                ),
            );
        }

        if (parentTaskItem) {
            transactionEntries.push(
                TaskTable.transactionDirectlyUpdateItem({
                    ...parentTaskItem,
                    addedChildTaskCount: parentTaskItem.addedChildTaskCount,
                    removedChildTaskCount: parentTaskItem.removedChildTaskCount + 1,
                    addedClosedChildTaskCount: parentTaskItem.addedClosedChildTaskCount,
                    removedClosedChildTaskCount:
                        parentTaskItem.removedClosedChildTaskCount +
                        (taskItem.statusType.value === "Closed" ? 1 : 0),
                }),
            );
        }

        for (const {newTaskItem} of updatedTaskItems) {
            transactionEntries.push(TaskTable.transactionDirectlyUpdateItem(newTaskItem));
        }

        const actionTransactionItem: TaskActionTransactionItem = {
            partitionType: "TaskActions",
            sortRangeType: "ActionTransaction",
            spaceId: taskItem.spaceId,
            committedTime: new Date(),
            actionTransactionId: generateId<TaskActionTransactionId>(),
            actions: [
                ...updatedTaskItems.map(
                    ({newTaskItem}): TaskAction => ({
                        type: "UpdateTask",
                        time: actionTime,
                        taskId: newTaskItem.taskId,
                        taskAction: {type: "Delete"},
                    }),
                ),
                ...filterMapArray(
                    updatedTaskItems,
                    ({oldTaskItem, newTaskItem}): TaskAction | null => {
                        const countKeys = [
                            "addedChildTaskCount",
                            "removedChildTaskCount",
                            "addedClosedChildTaskCount",
                            "removedClosedChildTaskCount",
                        ] as const;

                        const oldTaskCounts = pickObject(oldTaskItem, countKeys);
                        const newTaskCounts = pickObject(newTaskItem, countKeys);

                        if (isDeepEqual(oldTaskCounts, newTaskCounts)) return null;

                        return {
                            type: "UpdateTask",
                            // Match `commitTaskActionTransaction()`. Each extra action has +1 tick above
                            // the action time.
                            time: [actionTime[0], actionTime[1] + 1],
                            taskId: newTaskItem.taskId,
                            taskAction: {
                                type: "UpdateChildrenCounts",
                                ...newTaskCounts,
                            },
                        };
                    },
                ),
                ...(parentTaskItem
                    ? cast<Array<TaskAction>>([
                          {
                              type: "UpdateTask",
                              // Match `commitTaskActionTransaction()`. Each extra action has +1 tick above
                              // the action time.
                              time: [actionTime[0], actionTime[1] + 1],
                              taskId: parentTaskItem.taskId,
                              taskAction: {
                                  type: "UpdateChildrenCounts",
                                  addedChildTaskCount: parentTaskItem.addedChildTaskCount,
                                  removedChildTaskCount: parentTaskItem.removedChildTaskCount + 1,
                                  addedClosedChildTaskCount:
                                      parentTaskItem.addedClosedChildTaskCount,
                                  removedClosedChildTaskCount:
                                      parentTaskItem.removedClosedChildTaskCount +
                                      (taskItem.statusType.value === "Closed" ? 1 : 0),
                              },
                          },
                      ])
                    : []),
            ],
            wasProcessed: false,
        };

        transactionEntries.push(
            TaskActionTable.transactionCreateOrReplaceItem(actionTransactionItem),
        );

        await deleteTaskAndAllChildrenBeforeExecuteTestCheckpoint.waitForTest(
            context.actor.getAccountId(),
        );

        await DynamoTableSchema.executeTransaction(context, transactionEntries);

        afterCommitTaskActionTransaction(context, actionTransactionItem);

        return {
            spaceId: actionTransactionItem.spaceId,
            actions: actionTransactionItem.actions,
        };
    });
}

export const backfillTaskActionTransactionHistoryTestCounter = new TestCounter<SpaceId>();

/**
 * Get all action transactions since the provided start time in the
 * provided space.
 */
export async function backfillTaskActionTransactionHistory(
    context: Context<{
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        opensearch: OpensearchContextModule;
        actor: SystemActorContextModule;
    }>,
    spaceId: SpaceId,
    startCommittedTime: Date,
): Promise<
    Array<{
        spaceId: SpaceId;
        committedTime: Date;
        actions: ReadonlyArray<TaskAction>;
    }>
> {
    // Must have system access since we return all actions. We don't
    // filter out actions the current session doesn't have access to.
    context.actor.authorizeSystem();

    await authorizeSpaceAccess(context, spaceId);

    const actionTransactions: Array<{
        spaceId: SpaceId;
        committedTime: Date;
        actions: ReadonlyArray<TaskAction>;
    }> = [];

    backfillTaskActionTransactionHistoryTestCounter.incrementForTest(spaceId);

    for await (const item of TaskActionTable.query(context, {
        partitionKey: {
            partitionType: "TaskActions",
            spaceId,
        },
        startSortKey: {
            sortRangeType: "ActionTransaction",
            committedTime: startCommittedTime,
            actionTransactionId: getMinId<TaskActionTransactionId>(),
        },
        limit: "All",
        consistency: "Strong",
    })) {
        actionTransactions.push({
            spaceId: item.spaceId,
            committedTime: item.committedTime,
            actions: item.actions,
        });
    }

    return actionTransactions;
}

const TaskItemAuthorizationCache = new ContextCache<TaskId, TaskEssentialAttributesItem>();

/**
 * Gets a task to be used in authorization. If used in `TaskRealtimeService`
 * then you may provide a loader function to use an in-memory task
 * representation.
 *
 * 1. Attempts to get an in-memory task representation when used in
 *    `TaskRealtimeService` with `getTaskIndexDocIfExists`.
 *
 * 2. Otherwise loads the task from the database (cached within the action
 *    context).
 *
 * We force `getTaskIndexDocIfExists` to be synchronous. If you don't have the
 * task in memory then we should load from DynamoDB, not OpenSearch.
 */
async function getTaskItemForAuthorization(
    context: ServerSessionActionContext,
    taskId: TaskId,
    loaders: {getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined} | null,
): Promise<Omit<TaskEssentialAttributesItem, "childTaskIds">> {
    const taskIndexDoc = loaders?.getTaskIndexDocIfExists(taskId);
    if (taskIndexDoc) return convertTaskIndexDocToItem(taskIndexDoc);

    return TaskItemAuthorizationCache.get(context, taskId, () =>
        TaskTable.getItem(context, {
            partitionType: "Task",
            sortRangeType: "EssentialAttributes",
            taskId,
        }),
    );
}

const TaskCollectionItemAuthorizationCache = new ContextCache<
    TaskCollectionId,
    TaskCollectionEssentialAttributesItem
>();

/**
 * Gets a collection to be used in authorization. If used in
 * `TaskRealtimeService` then you may provide a loader function to use an
 * in-memory collection representation.
 *
 * 1. Attempts to get an in-memory collection representation when used in
 *    `TaskRealtimeService` with `getCollectionIndexDocIfExists`.
 *
 * 2. Otherwise loads the collection from the database (cached within the
 *    action context).
 *
 * We force `getCollectionIndexDocIfExists` to be synchronous. If you don't
 * have the collection in memory then we should load from DynamoDB, not
 * OpenSearch.
 */
async function getTaskCollectionItemForAuthorization(
    context: ServerSessionActionContext,
    collectionId: TaskCollectionId,
    loaders: {
        getCollectionIndexDocIfExists: (
            taskId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null,
): Promise<TaskCollectionEssentialAttributesItem> {
    const collectionIndexDoc = loaders?.getCollectionIndexDocIfExists(collectionId);
    if (collectionIndexDoc) return convertTaskCollectionIndexDocToItem(collectionIndexDoc);

    return TaskCollectionItemAuthorizationCache.get(context, collectionId, () =>
        TaskTable.getItem(context, {
            partitionType: "TaskCollection",
            sortRangeType: "EssentialAttributes",
            collectionId,
        }),
    );
}

/**
 * Evaluates whether the `AccountId` has access to the task collection item at
 * the provided access level.
 *
 * Returns true if the account has access.
 */
async function evaluateTaskCollectionAccessPolicy(
    context: Context<{
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    accountId: AccountId,
    spaceId: SpaceId,
    accessPolicy: TaskCollectionAccessPolicy,
    expectedAccessLevel: TaskCollectionAccessLevel,
): Promise<boolean> {
    if (accessPolicy.defaultGrant) {
        // If we ever add other default grant types then TypeScript will error here
        // forcing us to update this code.
        cast<"Space">(accessPolicy.defaultGrant.type);

        if (
            (await isAccountMemberOfSpace(context, spaceId, accountId)) &&
            hasTaskCollectionAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)
        ) {
            return true;
        }
    }

    const accountGrant = accessPolicy.accountGrantById.get(accountId);
    if (accountGrant && hasTaskCollectionAccessLevel(accountGrant.level, expectedAccessLevel)) {
        return true;
    }

    return false;
}

async function isTaskCollectionItemAccessAuthorized(
    context: Context<{
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    accountId: AccountId,
    collectionItem: TaskCollectionEssentialAttributesItem,
    expectedAccessLevel: TaskCollectionAccessLevel,
) {
    if (collectionItem.deletedTime) {
        return false;
    }

    return isTaskCollectionItemAccessAuthorizedAllowingDeletedTasks(
        context,
        accountId,
        collectionItem,
        expectedAccessLevel,
    );
}

async function isTaskCollectionItemAccessAuthorizedAllowingDeletedTasks(
    context: Context<{
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    accountId: AccountId,
    collectionItem: TaskCollectionEssentialAttributesItem,
    expectedAccessLevel: TaskCollectionAccessLevel,
) {
    // Check that the account has access to the space the collection is in.
    if (!(await isAccountMemberOfSpace(context, collectionItem.spaceId, accountId))) {
        return false;
    }

    return evaluateTaskCollectionAccessPolicy(
        context,
        accountId,
        collectionItem.spaceId,
        collectionItem.accessPolicy.value,
        expectedAccessLevel,
    );
}

async function authorizeTaskCollectionAccess(
    context: ServerSessionActionContext,
    collectionId: TaskCollectionId,
    expectedAccessLevel: TaskCollectionAccessLevel,
    loaders: {
        getCollectionIndexDocIfExists: (
            taskId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null,
) {
    const collectionItem = await getTaskCollectionItemForAuthorization(
        context,
        collectionId,
        loaders,
    );

    const hasAccess = await isTaskCollectionItemAccessAuthorized(
        context,
        context.actor.getAccountId(),
        collectionItem,
        expectedAccessLevel,
    );

    if (!hasAccess) {
        throw new PermissionDeniedError(
            quote`Actor does not have ${expectedAccessLevel} access level to task collection`,
        );
    }
}

/**
 * Can the provided account access the provided collection index doc? Returns
 * false if not.
 *
 * Be careful when using this function! You are expected to provide index docs
 * from an up-to-date source. You should not directly load from OpenSearch
 * since OpenSearch is at least 30 seconds behind at all times. This function
 * is only really safely useful in `TaskRealtimeService` which maintains
 * `TaskCollectionIndexDoc`s up-to-date in-memory.
 *
 * If you use this function you are taking on your own authorization
 * responsibilities. Like properly stopping data from being sent to the client
 * when this function returns false.
 */
// TODO(calebmer, 2023-08-22, #security): For our authorization logic to
// produce the correct results, it's essential that: 1) every committed action
// is indexed in a timely fashion, 2) every committed action is seen by
// realtime servers in a timely fashion. When you remove someone's access in
// Cyberworlds it may take a little bit for them to actually lose access
// (3-5min). However we guarantee they do eventually lose access.
//
// If we fail to index in OpenSearch an `UpdateAccessPolicy` action or don't
// send it to one of our realtime servers that's a big problem! Realtime
// servers will continue returning data in the collection without considering
// that access may have been removed.
//
// We need to set up systems that guarantee every action is indexed. This is
// probably some CRON job that reapplies actions which haven't been marked as
// applied. Since actions are CRDTs reapplying is safe.
export function isTaskCollectionIndexDocAccessAuthorized(
    context: Context<{
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    accountId: AccountId,
    collectionIndexDoc: TaskCollectionIndexDoc,
    expectedAccessLevel: TaskCollectionAccessLevel,
): Promise<boolean> {
    return isTaskCollectionItemAccessAuthorized(
        context,
        accountId,
        convertTaskCollectionIndexDocToItem(collectionIndexDoc),
        expectedAccessLevel,
    );
}

async function isTaskItemAccessAuthorized(
    context: Context<{
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    accountId: AccountId,
    taskItem: Omit<TaskEssentialAttributesItem, "childTaskIds">,
    expectedAccessLevel: TaskCollectionAccessLevel,
    loaders: {
        getTaskItem: (taskId: TaskId) => Promise<Omit<TaskEssentialAttributesItem, "childTaskIds">>;
        getCollectionItem: (
            taskId: TaskCollectionId,
        ) => Promise<TaskCollectionEssentialAttributesItem>;
    },
) {
    if (taskItem.deletedTime) return false;

    return isTaskItemAccessAuthorizedAllowingDeletedTasks(
        context,
        accountId,
        taskItem,
        expectedAccessLevel,
        loaders,
    );
}

async function isTaskItemAccessAuthorizedAllowingDeletedTasks(
    context: Context<{
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    accountId: AccountId,
    taskItem: Omit<TaskEssentialAttributesItem, "childTaskIds">,
    expectedAccessLevel: TaskCollectionAccessLevel,
    loaders: {
        getTaskItem: (taskId: TaskId) => Promise<Omit<TaskEssentialAttributesItem, "childTaskIds">>;
        getCollectionItem: (
            taskId: TaskCollectionId,
        ) => Promise<TaskCollectionEssentialAttributesItem>;
    },
): Promise<boolean> {
    // Check that the account has access to the space the task is in.
    if (!(await isAccountMemberOfSpace(context, taskItem.spaceId, accountId))) {
        return false;
    }

    // The task creator has edit access level on their own task.
    if (
        accountId === taskItem.creatorId &&
        hasTaskCollectionAccessLevel("Edit", expectedAccessLevel)
    ) {
        return true;
    }

    // The task assignee has edit access level on their own task.
    if (
        taskItem.assigneeId.value &&
        accountId === taskItem.assigneeId.value &&
        hasTaskCollectionAccessLevel("Edit", expectedAccessLevel)
    ) {
        return true;
    }

    // An array of `TaskCollectionId`s that authorize access to the task or `null`
    // if no `TaskCollectionId`s authorize access to the task.
    const authorizingCollectionItems = await runAllPromises(
        taskItem.collections.getArray().map(async ({collectionId}) => {
            const collectionItem = await loaders.getCollectionItem(collectionId);

            // Deleted collections don't grant any access.
            if (collectionItem.deletedTime) return null;

            const hasAccess = await evaluateTaskCollectionAccessPolicy(
                context,
                accountId,
                collectionItem.spaceId,
                collectionItem.accessPolicy.value,
                expectedAccessLevel,
            );

            return hasAccess ? collectionItem : null;
        }),
    );

    // We evaluate the access policies for all collections on a task but we only
    // need one passing access policy.
    if (authorizingCollectionItems.some(isNonNullable)) return true;

    if (taskItem.parentTaskId.value) {
        const parentTaskItem = await loaders.getTaskItem(taskItem.parentTaskId.value);

        // Parent tasks implicitly grant access to all of their child tasks. If we have
        // a parent task that is not deleted then check it before throwing a permission
        // denied error.
        if (!parentTaskItem.deletedTime) {
            return isTaskItemAccessAuthorized(
                context,
                accountId,
                parentTaskItem,
                expectedAccessLevel,
                loaders,
            );
        }
    }

    return false;
}

/**
 * Tests if the context's actor is allowed to access the provided task with the
 * provided access level. Returns true or false depending on whether task
 * access is authorized.
 *
 * Loads data from DynamoDB but if you are in `TaskRealtimeService` and have
 * up-to-date in-memory you may pass in a `loaders` object to use your
 * in-memory task instead. See the disclaimers on `authorizeTaskQueryAccess()`
 * before using the `loaders` object.
 */
async function isTaskAccessAuthorized(
    context: ServerSessionActionContext,
    taskId: TaskId,
    expectedAccessLevel: TaskCollectionAccessLevel,
    loaders: {
        getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined;
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null,
): Promise<boolean> {
    const taskItem = await getTaskItemForAuthorization(context, taskId, loaders);

    return isTaskItemAccessAuthorized(
        context,
        context.actor.getAccountId(),
        taskItem,
        expectedAccessLevel,
        {
            getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, loaders),
            getCollectionItem: collectionId =>
                getTaskCollectionItemForAuthorization(context, collectionId, loaders),
        },
    );
}

/**
 * Tests if the context's actor is allowed to access the provided task with the
 * provided access level. Throws an error if access is unauthorized.
 *
 * Loads data from DynamoDB but if you are in `TaskRealtimeService` and have
 * up-to-date in-memory you may pass in a `loaders` object to use your
 * in-memory task instead. See the disclaimers on `authorizeTaskQueryAccess()`
 * before using the `loaders` object.
 */
async function authorizeTaskAccess(
    context: ServerSessionActionContext,
    taskId: TaskId,
    expectedAccessLevel: TaskCollectionAccessLevel,
    loaders: {
        getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined;
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null,
) {
    const hasAccess = await isTaskAccessAuthorized(context, taskId, expectedAccessLevel, loaders);

    if (!hasAccess) {
        throw new PermissionDeniedError(
            quote`Actor does not have ${expectedAccessLevel} access level to task`,
        );
    }
}

/**
 * Tests if the context's actor is allowed to access the provided task item
 * with the provided access level. Throws an error if access is unauthorized.
 *
 * Loads data from DynamoDB but if you are in `TaskRealtimeService` and have
 * up-to-date in-memory you may pass in a `loaders` object to use your
 * in-memory task instead. See the disclaimers on `authorizeTaskQueryAccess()`
 * before using the `loaders` object.
 */
async function authorizeTaskItemAccess(
    context: ServerSessionActionContext,
    taskItem: TaskEssentialAttributesItem,
    expectedAccessLevel: TaskCollectionAccessLevel,
    loaders: {
        getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined;
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null,
) {
    const hasAccess = await isTaskItemAccessAuthorized(
        context,
        context.actor.getAccountId(),
        taskItem,
        expectedAccessLevel,
        {
            getTaskItem: taskId => getTaskItemForAuthorization(context, taskId, loaders),
            getCollectionItem: collectionId =>
                getTaskCollectionItemForAuthorization(context, collectionId, loaders),
        },
    );

    if (!hasAccess) {
        throw new PermissionDeniedError(
            quote`Actor does not have ${expectedAccessLevel} access level to task`,
        );
    }
}

/**
 * Can the provided account access the provided task index doc? Returns false
 * if not.
 *
 * Be careful when using this function! You are expected to provide index docs
 * from an up-to-date source. You should not directly load from OpenSearch
 * since OpenSearch is at least 30 seconds behind at all times. This function
 * is only really safely useful in `TaskRealtimeService` which maintains
 * `TaskIndexDoc`s up-to-date in-memory.
 *
 * If you use this function you are taking on your own authorization
 * responsibilities. Like properly stopping data from being sent to the client
 * when this function returns false.
 */
// TODO(calebmer, 2023-08-22, #security): For our authorization logic to
// produce the correct results, it's essential that: 1) every committed action
// is indexed in a timely fashion, 2) every committed action is seen by
// realtime servers in a timely fashion. When you remove someone's access in
// Cyberworlds it may take a little bit for them to actually lose access
// (3-5min). However we guarantee they do eventually lose access.
//
// If we fail to index in OpenSearch an `UpdateAccessPolicy` action or don't
// send it to one of our realtime servers that's a big problem! Realtime
// servers will continue returning data in the collection without considering
// that access may have been removed.
//
// We need to set up systems that guarantee every action is indexed. This is
// probably some CRON job that reapplies actions which haven't been marked as
// applied. Since actions are CRDTs reapplying is safe.
export function isTaskIndexDocAccessAuthorized(
    context: Context<{
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    accountId: AccountId,
    taskIndexDoc: TaskIndexDoc,
    expectedAccessLevel: TaskCollectionAccessLevel,
    loaders: {
        getTaskIndexDoc: (taskId: TaskId) => Promise<TaskIndexDoc>;
        getCollectionIndexDoc: (taskId: TaskCollectionId) => Promise<TaskCollectionIndexDoc>;
    },
): Promise<boolean> {
    return isTaskItemAccessAuthorized(
        context,
        accountId,
        convertTaskIndexDocToItem(taskIndexDoc),
        expectedAccessLevel,
        {
            getTaskItem: async taskId => {
                const taskIndexDoc = await loaders.getTaskIndexDoc(taskId);
                return convertTaskIndexDocToItem(taskIndexDoc);
            },
            getCollectionItem: async collectionId => {
                const collectionIndexDoc = await loaders.getCollectionIndexDoc(collectionId);
                return convertTaskCollectionIndexDocToItem(collectionIndexDoc);
            },
        },
    );
}

/**
 * Tests if we are allowed to execute a query with the provided filters and
 * sorts. Throws an error if unauthorized. If authorized then that means all
 * tasks in the query are also authorized and we don't need to check each task
 * individually.
 *
 * Consults DynamoDB by default but if you're in `TaskRealtimeService` and have
 * an up-to-date in-memory representation of tasks then you may provide the
 * `getTaskIndexDocIfExists` function and `getCollectionIndexDocIfExists`
 * function to skip making network requests for tasks/collections that exist in
 * memory.
 *
 * Be careful using `getTaskIndexDocIfExists` and
 * `getCollectionIndexDocIfExists`! Data loaded from the OpenSearch task index
 * is at least 30sec behind since that's the refresh interval. Only use those
 * options if you're in `TaskRealtimeService` and have an up-to-date in-memory
 * representation of tasks.
 */
// TODO(calebmer, 2023-08-22, #security): For our authorization logic to
// produce the correct results, it's essential that: 1) every committed action
// is indexed in a timely fashion, 2) every committed action is seen by
// realtime servers in a timely fashion. When you remove someone's access in
// Cyberworlds it may take a little bit for them to actually lose access
// (3-5min). However we guarantee they do eventually lose access.
//
// If we fail to index in OpenSearch an `UpdateAccessPolicy` action or don't
// send it to one of our realtime servers that's a big problem! Realtime
// servers will continue returning data in the collection without considering
// that access may have been removed.
//
// We need to set up systems that guarantee every action is indexed. This is
// probably some CRON job that reapplies actions which haven't been marked as
// applied. Since actions are CRDTs reapplying is safe.
export async function authorizeTaskQueryAccess(
    context: ServerSessionActionContext,
    {
        filters,
        sorts,
    }: {
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    },
    loaders: {
        getTaskIndexDocIfExists: (taskId: TaskId) => TaskIndexDoc | undefined;
        getCollectionIndexDocIfExists: (
            collectionId: TaskCollectionId,
        ) => TaskCollectionIndexDoc | undefined;
    } | null = null,
) {
    let hasAccess = false;

    // Account has edit access to all tasks they created. So authorize if we have
    // an exclusive creator filter for our session account.
    if (
        filters.creatorFilter?.accountIds.size === 1 &&
        filters.creatorFilter.type === "OneOf" &&
        filters.creatorFilter.accountIds.has(context.actor.getAccountId())
    ) {
        hasAccess = true;
    }

    // Account has edit access to tasks it is assigned to. So authorize if we have
    // an exclusive assignee filter for our session account.
    if (
        filters.assigneeFilter?.accountIds.size === 1 &&
        filters.assigneeFilter.type === "OneOf" &&
        filters.assigneeFilter.accountIds.has(context.actor.getAccountId())
    ) {
        hasAccess = true;
    }

    // You can only add tasks you created to your notepad. So a notepad filter for
    // an account implies a task creator filter.
    if (filters.notepadPageFilter?.accountId === context.actor.getAccountId()) {
        hasAccess = true;
    }

    await runAllPromiseThunks(
        async () => {
            if (!filters.collectionsFilter) return;

            await runAllPromises(
                filters.collectionsFilter.map(async clause => {
                    // Make sure we're authorized to view every referenced collection...
                    await runAllPromises(
                        Array.from(clause.keys(), async term => {
                            if (term === "IsEmpty") return;
                            await authorizeTaskCollectionAccess(context, term, "View", loaders);
                        }),
                    );

                    // For this filter to grant access, we need to guarantee the query only returns
                    // tasks that have at least one collection we can view.
                    //
                    // A normalized collections filter is in [conjunctive normal form][1]. That
                    // means if one of the "AND"ed clauses narrows down to only viewable collections
                    // this filter can grant access. That's what we check here.
                    //
                    // [1]: https://en.wikipedia.org/wiki/Conjunctive_normal_form
                    if (iterableEvery(clause, ([term, not]) => term !== "IsEmpty" && !not)) {
                        hasAccess = true;
                    }
                }),
            );
        },
        async () => {
            if (!filters.parentFilter) return;

            // View access on the parent task is inherited to child tasks.
            await authorizeTaskAccess(context, filters.parentFilter.parentTaskId, "View", loaders);

            hasAccess = true;
        },
        async () => {
            await runAllPromises(
                sorts.map(async sort => {
                    switch (sort.type) {
                        case "ParentPosition": {
                            // You are not allowed to sort by parent position unless you are also filtering
                            // by the parent task. This is because sorting by parent position reveals
                            // information about the parent task which might not be visible to you.
                            if (filters.parentFilter) break;

                            throw new PermissionDeniedError(
                                "Must filter by a parent task to sort by parent position",
                            );
                        }
                        case "CollectionPosition": {
                            // Optimization: If our filter contains the collection then we will authorize
                            // view access above.
                            if (
                                filters.collectionsFilter?.some(clause =>
                                    clause.has(sort.collectionId),
                                )
                            ) {
                                break;
                            }

                            await authorizeTaskCollectionAccess(
                                context,
                                sort.collectionId,
                                "View",
                                loaders,
                            );
                            break;
                        }
                        case "NotepadPagePosition": {
                            if (sort.accountId === context.actor.getAccountId()) break;

                            throw new PermissionDeniedError(
                                "Can't sort by notepad page that's not yours",
                            );
                        }
                        case "AssigneeActivePosition": {
                            // A task's active position is private to the account whom the task is
                            // assigned. Only allow sorting by active position when also filtering for
                            // tasks assigned to you.
                            if (
                                filters.assigneeFilter?.accountIds.size === 1 &&
                                filters.assigneeFilter.accountIds.has(context.actor.getAccountId())
                            ) {
                                break;
                            }

                            throw new PermissionDeniedError(
                                "Must filter assignee to session account to sort by active position",
                            );
                        }
                        default:
                            break;
                    }
                }),
            );
        },
    );

    if (!hasAccess) {
        throw new PermissionDeniedError(
            "Query may reveal tasks the session account is not allowed to see",
        );
    }
}

/**
 * If you have a `TaskIndexDoc` then you have all the data that's in a
 * `TaskEssentialAttributesItem`. This function converts between the two
 * formats.
 *
 * Be careful when using this function! Loading a `TaskIndexDoc` from
 * OpenSearch is at least 30sec behind a `TaskEssentialAttributesItem` loaded
 * from DynamoDB since 30sec is our OpenSearch refresh rate. If you're in
 * `TaskRealtimeService` then you have up-to-date `TaskIndexDoc`s in
 * `TaskRealtimeStore` so those are ok to use with this function.
 */
function convertTaskIndexDocToItem(
    task: TaskIndexDoc,
): Omit<TaskEssentialAttributesItem, "childTaskIds"> {
    return {
        partitionType: "Task",
        sortRangeType: "EssentialAttributes",
        taskId: task.id,
        spaceId: task.spaceId,
        creatorId: task.creator.accountId,
        createdTime: task.createdTime.absoluteTime,
        deletedTime: task.rawDeletedTime ?? null,
        statusType: new TaskStatusTypeRegister(task.status.value.type, task.status.version),
        parentTaskId: task.parent.taskId,
        addedChildTaskCount: task.addedChildTaskCount,
        removedChildTaskCount: task.removedChildTaskCount,
        addedClosedChildTaskCount: task.addedClosedChildTaskCount,
        removedClosedChildTaskCount: task.removedClosedChildTaskCount,
        collections: task.collections.raw.collections,
        assigneeId: new TaskAssigneeAccountIdRegister(
            task.assignee.value?.assignee.accountId ?? null,
            task.assignee.version,
        ),
    };
}

/**
 * If you have a `TaskCollectionIndexDoc` then you have all the data that's in
 * a `TaskCollectionEssentialAttributesItem`. This function converts between
 * the two formats.
 *
 * Be careful when using this function! See the disclaimer on
 * `convertTaskIndexDocToItem()`.
 */
function convertTaskCollectionIndexDocToItem(
    collection: TaskCollectionIndexDoc,
): TaskCollectionEssentialAttributesItem {
    return {
        partitionType: "TaskCollection",
        sortRangeType: "EssentialAttributes",
        collectionId: collection.id,
        spaceId: collection.spaceId,
        createdTime: collection.createdTime,
        deletedTime: collection.rawDeletedTime,
        accessPolicy: collection.accessPolicy,
    };
}

/**
 * Get the account's task notepad pages for the space. We will always return at
 * least one notepad page.
 */
export function getTaskNotepadPageIds(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<TaskNotepadPageIdCompressedSet> {
    return context.dynamo.retryTransaction(async context => {
        let notepadItem = await TaskTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "Notepad",
            accountId: context.actor.getAccountId(),
            spaceId,
        });

        if (!notepadItem) {
            notepadItem = {
                partitionType: "Account",
                sortRangeType: "Notepad",
                accountId: context.actor.getAccountId(),
                spaceId,
                // Generate the notepad with an initial page.
                pageIds: TaskNotepadPageIdCompressedSet.fromIds(
                    new Set([generateTaskNotepadPageId()]),
                ),
            };

            await TaskTable.createItem(context, notepadItem, {
                // By default `createItem()` condition check errors are not retried. In this
                // case it's ok if a concurrent process creates a notepad item. We want to
                // retry and load that item.
                isConditionCheckErrorRetriable: true,
            });
        }

        if (notepadItem.pageIds.isEmpty()) {
            notepadItem = {
                ...notepadItem,
                // Add an initial page to the notepad item.
                pageIds: TaskNotepadPageIdCompressedSet.fromIds(
                    new Set([generateTaskNotepadPageId()]),
                ),
            };

            await TaskTable.directlyUpdateItem(context, notepadItem);
        }

        return notepadItem.pageIds;
    });
}

// After how many months should our expansion state expire?
//
// We expire expansion state to not incur storage costs for dead views,
// accounts, or browsers.
//
// The expiration time should be long enough that the user doesn't remember or
// doesn't care about losing any expansion state.
//
// We pick this value so that if a user looks at a grid view once a quarter,
// expanded task state is maintained.
const taskGridViewExpansionStateExpirationMonths = 4;

// After how many months should we renew expansion state expiration times?
//
// We renew expansion state items that are close to expiring if the user
// accesses them so we don't expire expansion states that are actively being
// used.
const taskGridViewExpansionStateExpirationRenewalMonths = 2;

/**
 * Get the key we use for storing the expansion state of a grid view.
 *
 * Uniqueness is not guaranteed! We hash `filters` and `sorts` to avoid storing
 * the entire query definition. However as with any hash function collisions
 * are very unlikely but possible.
 *
 * For the purpose of grid view expansion state we find collisions acceptable
 * given expansion state is also partitioned by `SpaceId`, `AccountId`, and
 * `BrowserId`.
 */
function getTaskGridViewExpansionStateKey({
    filters,
    sorts,
}: {
    filters: TaskQueryNormalizedFilters;
    sorts: ReadonlyArray<TaskQueryNormalizedSort>;
}) {
    const queryKey = stringifyForDeepEqualCheck({filters, sorts});
    const queryKeyMidpointIndex = Math.floor(queryKey.length / 2);

    const queryKey1 = queryKey.slice(0, queryKeyMidpointIndex);
    const queryKey2 = queryKey.slice(queryKeyMidpointIndex);

    // We use two hashes (one on the first half of the key, one on the second half)
    // as any easy way to reduce collision chance. However collisions are still not
    // impossible.
    //
    // Thread describing this issue:
    // https://contributors.scala-lang.org/t/murmur-hash-conflicts-when-hashing-many-items/1506
    const queryKeyHash1 = murmurhash.v3(queryKey1).toString(16).padStart(8, "0");
    const queryKeyHash2 = murmurhash.v3(queryKey2).toString(16).padStart(8, "0");

    return `${queryKeyHash1}${queryKeyHash2}`;
}

/**
 * Update the `TaskGridViewExpansionState` for this browser.
 */
export async function updateTaskGridViewExpansionState(
    context: ServerSessionActionContext,
    {
        spaceId,
        browserId,
        filters,
        sorts,
        state,
    }: {
        spaceId: SpaceId;
        browserId: BrowserId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        state: TaskGridViewExpansionState;
    },
) {
    await authorizeSpaceAccess(context, spaceId);

    if (state === null) {
        await TaskTable.deleteItemWithKeyIfExists(context, {
            partitionType: "TaskGridViewExpansionState",
            sortRangeType: "Attributes",
            spaceId,
            accountId: context.actor.getAccountId(),
            browserId,
            viewKey: getTaskGridViewExpansionStateKey({filters, sorts}),
        });
    } else {
        await TaskTable.createOrReplaceItem(context, {
            partitionType: "TaskGridViewExpansionState",
            sortRangeType: "Attributes",
            spaceId,
            accountId: context.actor.getAccountId(),
            browserId,
            viewKey: getTaskGridViewExpansionStateKey({filters, sorts}),
            state,
            expirationTime: addMonths(new Date(), taskGridViewExpansionStateExpirationMonths),
        });
    }
}

/**
 * Get the `TaskGridViewExpansionState` for this browser. If the state hasn't
 * been updated in a while and is about to expire then we extend the expiration
 * time.
 */
export async function getTaskGridViewExpansionState(
    context: ServerSessionActionContext,
    {
        spaceId,
        browserId,
        filters,
        sorts,
    }: {
        spaceId: SpaceId;
        browserId: BrowserId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    },
): Promise<TaskGridViewExpansionState> {
    const item = await TaskTable.getItemIfExists(context, {
        partitionType: "TaskGridViewExpansionState",
        sortRangeType: "Attributes",
        spaceId,
        accountId: context.actor.getAccountId(),
        browserId,
        viewKey: getTaskGridViewExpansionStateKey({filters, sorts}),
    });

    // If the grid view's expansion state hasn't been updated in a while but is
    // still being read then we want to extend its expiration time.
    if (
        item &&
        differenceInMonths(item.expirationTime, new Date()) <=
            taskGridViewExpansionStateExpirationRenewalMonths
    ) {
        const newExpirationTime = addMonths(new Date(), taskGridViewExpansionStateExpirationMonths);

        context.process.waitUntil(
            TaskTable.createOrReplaceItem(context, {
                ...item,
                expirationTime: newExpirationTime,
            }),
        );
    }

    return item?.state ?? null;
}
