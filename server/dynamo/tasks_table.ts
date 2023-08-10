import {
    AppActionContext,
    AppSessionActionContext,
    AppSystemActionContext,
} from "~/server/dynamo/context/app_action_context.js";
import {DynamoTransactionEntry} from "~/server/dynamo/helpers/dynamo_transaction_entry.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema.js";
import {
    DynamoTableItemType,
    DynamoTableSchema,
} from "~/server/dynamo/internal/dynamo_table_schema.js";
import {authorizeSpaceAccess, isAccountMemberOfSpace} from "~/server/dynamo/spaces_table.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
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
    compareHybridLogicalTimes,
    maxHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId, getMinId} from "~/shared/id/id.js";
import {
    AccountId,
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
    TaskCollectionAccessPolicyRegister,
    hasTaskCollectionAccessLevel,
} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskNotepadPageIdCompressedSetSchema} from "~/shared/tasks/task_notepad_page_id.js";
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
const TaskActionsTable = DynamoTableSchema.new({
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
                    }),
                },
            ],
        },
    ],
});

const TaskStatusTypeRegister = createCrdtRegister(
    Schema.enum<TaskStatus["type"]>(["Open", "Closed"]),
);

/**
 * Data related to tasks. Contains some views of task actions (e.g. the
 * `EssentialAttributes` items) and some data unrelated to task fields which
 * don't participate in querying (like notes, comments, revision history).
 */
const TasksTable = DynamoTableSchema.new({
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
                        createdTime: Schema.date,
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
                        createdTime: Schema.date,

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
                        addedChildTaskCount: Schema.integer,
                        removedChildTaskCount: Schema.integer,
                        addedClosedChildTaskCount: Schema.integer,
                        removedClosedChildTaskCount: Schema.integer,

                        /**
                         * The collections this task is a part of. A task inherits the highest access
                         * level from its collections.
                         */
                        collections: TaskCollectionSet.schema,
                    }),
                },
            ],
        },
    ],
});

type TaskActionTransactionItem = DynamoTableItemType<
    typeof TaskActionsTable,
    "TaskActions",
    "ActionTransaction"
>;

type TaskAccountNotepadItem = DynamoTableItemType<typeof TasksTable, "Account", "Notepad">;

type TaskEssentialAttributesItem = DynamoTableItemType<
    typeof TasksTable,
    "Task",
    "EssentialAttributes"
>;

type TaskCollectionEssentialAttributesItem = DynamoTableItemType<
    typeof TasksTable,
    "TaskCollection",
    "EssentialAttributes"
>;

export const commitTaskActionTransactionBeforeExecuteTestCheckpoint =
    new TestCheckpoint<AccountId>();

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
    context: AppSessionActionContext,
    spaceId: SpaceId,
    actions: ReadonlyArray<TaskAction>,
): Promise<{extraActions: ReadonlyArray<TaskAction>}> {
    return context.tracer.withSpan("commitTaskActionTransaction", async (context, span) => {
        span.addData({
            tasks: {
                actions: actions.map(getTaskActionLabel).join(","),
                actionCount: actions.length,
            },
        });

        const {actionTransactionId, extraActions} = await TaskActionTransactionCommitState.commit(
            context,
            spaceId,
            actions,
        );

        span.addData({
            tasks: {
                actionTransactionId,
            },
        });

        const finalActions = [...actions, ...extraActions];

        // Make sure we include extra actions in our `TracerSpan` if there were any.
        if (extraActions.length > 0) {
            span.addData({
                tasks: {
                    actions: finalActions.map(getTaskActionLabel).join(","),
                    actionCount: finalActions.length,
                },
            });
        }

        // After successfully committing out action transaction, in the background
        // index the action transaction.
        context.tasks.indexActionTransactionAssumingItsCommitted(
            spaceId,
            actionTransactionId,
            finalActions,
        );

        return {extraActions};
    });
}

/**
 * Abstraction for managing state during a `commitTaskActionTransaction()`
 * call. A task may be updated multiple times within a transaction so we need
 * to keep track of previous writes and return them if another action in the
 * transaction attempts to read again.
 */
class TaskActionTransactionCommitState {
    private readonly _context: AppSessionActionContext;
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

    private constructor(context: AppSessionActionContext, spaceId: SpaceId) {
        this._context = context;
        this._spaceId = spaceId;
    }

    public static commit(
        context: AppSessionActionContext,
        spaceId: SpaceId,
        actions: ReadonlyArray<TaskAction>,
    ): Promise<{
        actionTransactionId: TaskActionTransactionId;
        committedTime: Date;
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
                            TasksTable.transactionCreateItem(transactionEntry.taskItem),
                        );
                        break;
                    }
                    case "DirectlyUpdateItem": {
                        transactionEntries.push(
                            TasksTable.transactionDirectlyUpdateItem(transactionEntry.taskItem),
                        );
                        break;
                    }
                    case "DirectlyUpdateItemLockVersion": {
                        transactionEntries.push(
                            TasksTable.transactionDirectlyUpdateItemLockVersion(
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
                    // For our extra action's time, add a tick to the max action time.
                    maxActionTime = [maxActionTime[0], maxActionTime[1] + 1];

                    extraActions.push({
                        type: "UpdateTask",
                        time: maxActionTime,
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
                            TasksTable.transactionCreateItem(transactionEntry.collectionItem),
                        );
                        break;
                    }
                    case "DirectlyUpdateItem": {
                        transactionEntries.push(
                            TasksTable.transactionDirectlyUpdateItem(
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
                    TasksTable.transactionDirectlyUpdateItem(
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
            };

            if (transactionEntries.length > 0) {
                transactionEntries.push(
                    TaskActionsTable.transactionCreateOrReplaceItem(actionTransactionItem),
                );

                await DynamoTableSchema.executeTransaction(context, transactionEntries);
            } else {
                await TaskActionsTable.createOrReplaceItem(context, actionTransactionItem);
            }

            return {
                actionTransactionId: actionTransactionItem.actionTransactionId,
                committedTime: actionTransactionItem.committedTime,
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
        return time - this._startTime < 2 * 60 * 1000;
    }

    public getTaskItemIfExists(taskId: TaskId): Promise<TaskEssentialAttributesItem | null> {
        return getOrSetDefaultMapValue(this._taskItemById, taskId, async () => {
            const taskItem = await TasksTable.getItemIfExists(this._context, {
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
            const collectionItem = await TasksTable.getItemIfExists(this._context, {
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
                let notepadPagesItem = await TasksTable.getItemIfExists(this._context, {
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
                    pageIds: new Set(),
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

    public evaluateTaskCollectionItemAccessPolicy(
        collectionItem: TaskCollectionEssentialAttributesItem,
        expectedAccessLevel: TaskCollectionAccessLevel,
    ) {
        return evaluateTaskCollectionItemAccessPolicy(
            this._context,
            collectionItem,
            this._context.actor.getAccountId(),
            expectedAccessLevel,
        );
    }
}

async function actuallyCommitTaskActionTransaction(
    // We intentionally don't pass in `context` since we want all DynamoDB access
    // to go through this `state` object. That way we force reads to go through our
    // local cache.
    state: TaskActionTransactionCommitState,
    spaceId: SpaceId,
    actionTransaction: ReadonlyArray<TaskAction>,
) {
    const authorizeTaskItemAccess = async (
        taskItem: TaskEssentialAttributesItem,
        expectedAccessLevel: TaskCollectionAccessLevel,
    ): Promise<void> => {
        // The task creator has an edit access level on their own task.
        if (
            state.getActorAccountId() === taskItem.creatorId &&
            hasTaskCollectionAccessLevel("Edit", expectedAccessLevel)
        ) {
            return;
        }

        // An array of `TaskCollectionId`s that authorize access to the task or `null`
        // if no `TaskCollectionId`s authorize access to the task.
        const authorizingCollectionItems = await runAllPromises(
            taskItem.collections.getArray().map(async ({collectionId}) => {
                const collectionItem = await state.getCollectionItem(collectionId);

                const hasAccess = await state.evaluateTaskCollectionItemAccessPolicy(
                    collectionItem,
                    expectedAccessLevel,
                );

                return hasAccess ? collectionItem : null;
            }),
        );

        // We evaluate the access policies for all collections on a task but we only
        // need one passing access policy. We set that access policy as a dependency of
        // our transaction.
        if (authorizingCollectionItems.some(isNonNullable)) return;

        if (taskItem.parentTaskId.value) {
            const parentTaskItem = await state.getTaskItem(taskItem.parentTaskId.value);

            // Parent tasks implicitly grant access to all of their child tasks. If we have
            // a parent task that is not deleted then check it before throwing a permission
            // denied error.
            if (!parentTaskItem.deletedTime) {
                return authorizeTaskItemAccess(parentTaskItem, expectedAccessLevel);
            }
        }

        throw new PermissionDeniedError(
            quote`Actor does not have ${expectedAccessLevel} access level to task`,
        );
    };

    const authorizeCollectionAccess = async (
        collectionId: TaskCollectionId,
        expectedAccessLevel: TaskCollectionAccessLevel,
    ): Promise<void> => {
        const collectionItem = await state.getCollectionItem(collectionId);

        const hasAccess = await state.evaluateTaskCollectionItemAccessPolicy(
            collectionItem,
            expectedAccessLevel,
        );

        if (!hasAccess) {
            throw new PermissionDeniedError(
                quote`Actor does not have ${expectedAccessLevel} access level to task collection`,
            );
        }
    };

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
                            createdTime: new Date(action.time[0]),
                            deletedTime: null,
                            statusType: new TaskStatusTypeRegister("Open", action.time),
                            parentTaskId: new TaskParentTaskIdRegister(null, action.time),
                            addedChildTaskCount: 0,
                            removedChildTaskCount: 0,
                            addedClosedChildTaskCount: 0,
                            removedClosedChildTaskCount: 0,
                            collections: TaskCollectionSet.empty,
                        });
                        break;
                    }
                    case "Undelete": {
                        const taskItem = await state.getTaskItemIfExists(taskId);
                        if (!taskItem) throw new NotFoundError("Task not found");
                        if (!taskItem.deletedTime)
                            throw new FailedPreconditionError("Expected task to be deleted");

                        await authorizeTaskItemAccess(taskItem, "Edit");

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
                        break;
                    }
                    default: {
                        const taskItem = await state.getTaskItemIfExists(taskId);
                        if (!taskItem) throw new NotFoundError("Task not found");
                        if (taskItem.deletedTime)
                            throw new FailedPreconditionError("Task was deleted");

                        await authorizeTaskItemAccess(taskItem, "Edit");

                        switch (taskAction.type) {
                            case "Delete": {
                                if (
                                    compareHybridLogicalTimes(action.time, [
                                        taskItem.createdTime.getTime(),
                                        0,
                                    ]) <= 0
                                ) {
                                    throw new FailedPreconditionError(
                                        "Delete action time is less than create action time",
                                    );
                                }

                                state.updateTaskItem({
                                    ...taskItem,
                                    deletedTime: action.time,
                                });
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
                                        await authorizeTaskItemAccess(newParentTaskItem, "Edit");

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
                                                        displayMessage: errorDisplayMessage`Can’t move a task to the subtasks of one of its own subtasks. Check your task’s subtasks and try removing the one you want to move your task into.`,
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
                                            const oldParentTask = await state.getTaskItem(
                                                oldParentTaskId.value,
                                            );

                                            // TODO(calebmer): We could optimize this by using an `UpdateItem`
                                            // transaction entry that increments our attributes (and
                                            // `updateLockVersion`). This would not require a condition check so would
                                            // save us RCUs.
                                            state.updateTaskItem(
                                                {
                                                    ...oldParentTask,
                                                    removedChildTaskCount:
                                                        oldParentTask.removedChildTaskCount + 1,
                                                    removedClosedChildTaskCount:
                                                        oldParentTask.removedClosedChildTaskCount +
                                                        (taskItem.statusType.value === "Closed"
                                                            ? 1
                                                            : 0),
                                                },
                                                {shouldCommitExtraUpdateChildrenCountAction: true},
                                            );
                                        },
                                        async () => {
                                            if (newParentTaskId.value === null) return;

                                            // Should be cached from authorization...
                                            const newParentTask = await state.getTaskItem(
                                                newParentTaskId.value,
                                            );

                                            // TODO(calebmer): We could optimize this by using an `UpdateItem`
                                            // transaction entry that increments our attributes (and
                                            // `updateLockVersion`). This would not require a condition check so would
                                            // save us RCUs.
                                            state.updateTaskItem(
                                                {
                                                    ...newParentTask,
                                                    addedChildTaskCount:
                                                        newParentTask.addedChildTaskCount + 1,
                                                    addedClosedChildTaskCount:
                                                        newParentTask.addedClosedChildTaskCount +
                                                        (taskItem.statusType.value === "Closed"
                                                            ? 1
                                                            : 0),
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
                                await authorizeTaskItemAccess(parentTaskItem, "Edit");
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
                                await authorizeCollectionAccess(taskAction.collectionId, "Edit");

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
                                await authorizeCollectionAccess(taskAction.collectionId, "Edit");

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

                                // If you have collection edit access then you implicitly also have task edit
                                // access.
                                await authorizeCollectionAccess(taskAction.collectionId, "Edit");
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

                                await authorizeTaskItemAccess(taskItem, "View");
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
                                        const newParentTask = await state.getTaskItem(
                                            taskItem.parentTaskId.value,
                                        );

                                        // TODO(calebmer): We could optimize this by using an `UpdateItem`
                                        // transaction entry that increments our attributes (and
                                        // `updateLockVersion`). This would not require a condition check so would
                                        // save us RCUs.
                                        state.updateTaskItem(
                                            {
                                                ...newParentTask,
                                                addedClosedChildTaskCount:
                                                    newParentTask.addedClosedChildTaskCount + 1,
                                            },
                                            {shouldCommitExtraUpdateChildrenCountAction: true},
                                        );
                                    }

                                    if (
                                        oldStatusType.value === "Closed" &&
                                        newStatusType.value !== "Closed"
                                    ) {
                                        // May be cached from authorization...
                                        const newParentTask = await state.getTaskItem(
                                            taskItem.parentTaskId.value,
                                        );

                                        // TODO(calebmer): We could optimize this by using an `UpdateItem`
                                        // transaction entry that increments our attributes (and
                                        // `updateLockVersion`). This would not require a condition check so would
                                        // save us RCUs.
                                        state.updateTaskItem(
                                            {
                                                ...newParentTask,
                                                removedClosedChildTaskCount:
                                                    newParentTask.removedClosedChildTaskCount + 1,
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

                                if (
                                    taskAction.assigneeStatus.type === "Active" &&
                                    !state.isTimeReasonable(
                                        taskAction.assigneeStatus.position.orderTime[0],
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                // NOCOMMIT: Currently any user can change the `position` of a user's
                                // active tasks? This seems wrong. The position of a user's active tasks should
                                // be personal and private. Maybe we set this to null and infer it? Unless the
                                // account explicitly sets it?
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
                            createdTime: new Date(action.time[0]),
                            deletedTime: null,
                            accessPolicy: new TaskCollectionAccessPolicyRegister(
                                collectionAction.accessPolicy,
                                action.time,
                            ),
                        };

                        if (
                            !(await state.evaluateTaskCollectionItemAccessPolicy(
                                newCollectionItem,
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

                        await authorizeCollectionAccess(collectionId, "Manage");

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
                                    compareHybridLogicalTimes(action.time, [
                                        collectionItem.createdTime.getTime(),
                                        0,
                                    ]) <= 0
                                ) {
                                    throw new FailedPreconditionError(
                                        "Delete action time is less than create action time",
                                    );
                                }

                                await authorizeCollectionAccess(collectionId, "Manage");

                                state.updateCollectionItem({
                                    ...collectionItem,
                                    deletedTime: action.time,
                                });
                                break;
                            }
                            case "UpdateName": {
                                await authorizeCollectionAccess(collectionId, "Manage");
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

                                await authorizeCollectionAccess(collectionId, "Manage");

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

                if (notepadItem.pageIds.has(notepadPageId))
                    throw new FailedPreconditionError("Notepad page already exists");

                const newPageIds = new Set(notepadItem.pageIds);
                newPageIds.add(notepadPageId);

                state.updateActorNotepadItem({
                    ...notepadItem,
                    pageIds: newPageIds,
                });
                break;
            }
            default:
                throw exhaustive(action);
        }
    }
}

/**
 * Evaluates whether the `AccountId` has access to the task collection item at
 * the provided access level.
 *
 * Returns true if the account has access.
 */
async function evaluateTaskCollectionItemAccessPolicy(
    context: AppActionContext,
    collectionItem: TaskCollectionEssentialAttributesItem,
    accountId: AccountId,
    expectedAccessLevel: TaskCollectionAccessLevel,
): Promise<boolean> {
    if (collectionItem.accessPolicy.value.defaultGrant) {
        // If we ever add other default grant types then TypeScript will error here
        // forcing us to update this code.
        cast<"Space">(collectionItem.accessPolicy.value.defaultGrant.type);

        if (
            (await isAccountMemberOfSpace(context, collectionItem.spaceId, accountId)) &&
            hasTaskCollectionAccessLevel(
                collectionItem.accessPolicy.value.defaultGrant.level,
                expectedAccessLevel,
            )
        ) {
            return true;
        }
    }

    const accountGrant = collectionItem.accessPolicy.value.accountGrantById.get(accountId);
    if (accountGrant && hasTaskCollectionAccessLevel(accountGrant.level, expectedAccessLevel)) {
        return true;
    }

    return false;
}

/**
 * Get all action transactions since the provided start time in the
 * provided space.
 */
export async function backfillTaskActionTransactionHistory(
    context: AppSystemActionContext,
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

    const actionTransactions: Array<{
        spaceId: SpaceId;
        committedTime: Date;
        actions: ReadonlyArray<TaskAction>;
    }> = [];

    for await (const item of TaskActionsTable.query(context, {
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
