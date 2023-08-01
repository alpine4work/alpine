import {differenceInHours} from "date-fns";
import {
    AppActionContext,
    AppSessionActionContext,
} from "~/server/dynamo/context/app_action_context.js";
import {DynamoTransactionEntry} from "~/server/dynamo/helpers/dynamo_transaction_entry.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema.js";
import {
    DynamoTableItemType,
    DynamoTableSchema,
} from "~/server/dynamo/internal/dynamo_table_schema.js";
import {authorizeSpaceAccess, isAccountMemberOfSpace} from "~/server/dynamo/spaces_table.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    SpaceId,
    TaskActionTransactionId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskParentTaskIdRegister} from "~/shared/tasks/actions/task_action.js";
import {
    TaskSpaceAction,
    TaskSpaceActionSchema,
    getTaskSpaceActionLabel,
} from "~/shared/tasks/actions/task_space_action.js";
import {
    TaskCollectionAccessLevel,
    TaskCollectionAccessPolicyRegister,
    hasTaskCollectionAccessLevel,
} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskNotepadPageIdCompressedSetSchema} from "~/shared/tasks/task_notepad_page_id.js";

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
                         * actions with identical `actionTime`s.
                         */
                        actionTransactionId: DynamoKeyAttributeSchema.id<TaskActionTransactionId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * Actions which should always be atomically applied together.
                         */
                        actions: Schema.array(TaskSpaceActionSchema),
                    }),
                },
            ],
        },
    ],
});

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
                        creatorId: Schema.id<AccountId>(),
                        createdTime: Schema.date,
                        deletedTime: Schema.date.nullable(),
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
                        deletedTime: Schema.date.nullable(),

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

export const commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint =
    new TestCheckpoint<AccountId>();

/**
 * Commit a transaction of `TaskSpaceAction`s. Authorizes that each action is
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
export function commitTaskSpaceActionTransaction(
    context: AppSessionActionContext,
    spaceId: SpaceId,
    actionTransaction: ReadonlyArray<TaskSpaceAction>,
): Promise<void> {
    return context.tracer.withSpan("commitTaskSpaceActionTransaction", async (context, span) => {
        span.addData({
            tasks: {
                actions: actionTransaction.map(getTaskSpaceActionLabel).join(","),
                actionCount: actionTransaction.length,
            },
        });

        const {actionTransactionId, committedTime} =
            await TaskSpaceActionTransactionCommitState.commit(context, spaceId, actionTransaction);

        span.addData({
            tasks: {
                actionTransactionId,
                actionTransactionCommittedTime: serializeDateString(committedTime),
            },
        });
    });
}

/**
 * Abstraction for managing state during a `commitTaskSpaceActionTransaction()`
 * call. A task may be updated multiple times within a transaction so we need
 * to keep track of previous writes and return them if another action in the
 * transaction attempts to read again.
 */
class TaskSpaceActionTransactionCommitState {
    private readonly _context: AppSessionActionContext;
    private readonly _spaceId: SpaceId;
    private readonly _startTime = new Date();

    // We may only have one DynamoDB transaction entry for each item. So we need to
    // merge all updates we want to make on an item into a single transaction entry.
    private readonly _transactionEntryByTaskId = new Map<
        TaskId,
        {
            taskItem: TaskEssentialAttributesItem;
            action: "CreateItem" | "DirectlyUpdateItem" | "DirectlyUpdateItemLockVersion";
        }
    >();

    // We may only have one DynamoDB transaction entry for each item. So we need to
    // merge all updates we want to make on an item into a single transaction entry.
    private readonly _transactionEntryByCollectionId = new Map<
        TaskCollectionId,
        {
            collectionItem: TaskCollectionEssentialAttributesItem;
            action: "CreateItem" | "DirectlyUpdateItem";
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
        actionTransaction: ReadonlyArray<TaskSpaceAction>,
    ): Promise<{
        actionTransactionId: TaskActionTransactionId;
        committedTime: Date;
    }> {
        return context.dynamo.retryTransaction(async context => {
            await authorizeSpaceAccess(context, spaceId);

            const state = new TaskSpaceActionTransactionCommitState(context, spaceId);

            await actuallyCommitTaskSpaceActionTransaction(state, spaceId, actionTransaction);

            const transactionEntries: Array<DynamoTransactionEntry> = [];

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

            await commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint.waitForTest(
                context.actor.getAccountId(),
            );

            const actionTransactionItem: TaskActionTransactionItem = {
                partitionType: "TaskActions",
                sortRangeType: "ActionTransaction",
                spaceId,
                committedTime: new Date(),
                actionTransactionId: generateId<TaskActionTransactionId>(),
                actions: actionTransaction,
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
    public isChangeTimeReasonable(time: Date): boolean {
        return differenceInHours(time, this._startTime, {roundingMethod: "floor"}) <= 4;
    }

    public getTaskItemIfExists(taskId: TaskId): Promise<TaskEssentialAttributesItem | null> {
        return getOrSetDefaultMapValue(this._taskItemById, taskId, async () => {
            const taskItem = await TasksTable.getItemIfExists(this._context, {
                partitionType: "Task",
                sortRangeType: "EssentialAttributes",
                taskId,
            });
            if (!taskItem) return null;

            // NOCOMMIT: Test
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
                taskItem,
                action: "CreateItem" as const,
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

    public updateTaskItem(taskItem: TaskEssentialAttributesItem) {
        this._taskItemById.set(taskItem.taskId, Promise.resolve(taskItem));

        const transactionEntry = getOrSetDefaultMapValue(
            this._transactionEntryByTaskId,
            taskItem.taskId,
            () => ({
                taskItem,
                action: "DirectlyUpdateItem" as const,
            }),
        );

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
                taskItem,
                action: "DirectlyUpdateItemLockVersion" as const,
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

            // NOCOMMIT: Test
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

async function actuallyCommitTaskSpaceActionTransaction(
    // We intentionally don't pass in `context` since we want all DynamoDB access
    // to go through this `state` object. That way we force reads to go through our
    // local cache.
    state: TaskSpaceActionTransactionCommitState,
    spaceId: SpaceId,
    actionTransaction: ReadonlyArray<TaskSpaceAction>,
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
        switch (action.type) {
            case "UpdateTask": {
                const {taskId, taskAction} = action;

                switch (taskAction.type) {
                    case "Create": {
                        if (!state.isChangeTimeReasonable(taskAction.createdTime.absoluteTime)) {
                            throw new InvalidArgumentError(
                                "Action `createdTime` is too far in the future",
                            );
                        }

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
                            createdTime: taskAction.createdTime.absoluteTime,
                            deletedTime: null,
                            parentTaskId: new TaskParentTaskIdRegister(
                                null,
                                taskAction.createdTime.absoluteTime,
                            ),
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

                        if (taskAction.undeletedTime <= taskItem.deletedTime) {
                            throw new FailedPreconditionError(
                                "Action `undeletedTime` is less than task `deletedTime`",
                            );
                        }

                        if (!state.isChangeTimeReasonable(taskAction.undeletedTime)) {
                            throw new InvalidArgumentError(
                                "Action `undeletedTime` is too far in the future",
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
                                if (taskAction.deletedTime <= taskItem.createdTime) {
                                    throw new FailedPreconditionError(
                                        "Action `deletedTime` is less than task `createdTime`",
                                    );
                                }

                                if (!state.isChangeTimeReasonable(taskAction.deletedTime)) {
                                    throw new InvalidArgumentError(
                                        "Action `deletedTime` is too far in the future",
                                    );
                                }

                                state.updateTaskItem({
                                    ...taskItem,
                                    deletedTime: taskAction.deletedTime,
                                });
                                break;
                            }
                            case "UpdateParentTaskId": {
                                if (
                                    !state.isChangeTimeReasonable(
                                        taskAction.parentTaskIdAction.updatedTime,
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `updatedTime` is too far in the future",
                                    );
                                }

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
                                        if (taskAction.parentTaskIdAction.value === null) return;

                                        const newParentTaskItem = await state.getTaskItemIfExists(
                                            taskAction.parentTaskIdAction.value,
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

                                state.updateTaskItem({
                                    ...taskItem,
                                    parentTaskId: taskItem.parentTaskId.apply(
                                        taskAction.parentTaskIdAction,
                                    ),
                                });
                                break;
                            }
                            case "UpdateParentPosition": {
                                if (
                                    !state.isChangeTimeReasonable(
                                        taskAction.parentPositionAction.updatedTime,
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `updatedTime` is too far in the future",
                                    );
                                }

                                if (
                                    !state.isChangeTimeReasonable(
                                        taskAction.parentPositionAction.value.orderTime,
                                    )
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
                            case "UpdateCollections": {
                                const {collectionsAction} = taskAction;

                                await authorizeCollectionAccess(collectionsAction.key, "Edit");

                                switch (collectionsAction.type) {
                                    case "Set": {
                                        if (
                                            !state.isChangeTimeReasonable(
                                                collectionsAction.updatedTime,
                                            )
                                        ) {
                                            throw new InvalidArgumentError(
                                                "Action `updatedTime` is too far in the future",
                                            );
                                        }
                                        break;
                                    }
                                    case "Delete": {
                                        if (
                                            !state.isChangeTimeReasonable(
                                                collectionsAction.deletedTime,
                                            )
                                        ) {
                                            throw new InvalidArgumentError(
                                                "Action `deletedTime` is too far in the future",
                                            );
                                        }
                                        break;
                                    }
                                    default:
                                        throw exhaustive(collectionsAction);
                                }

                                state.updateTaskItem({
                                    ...taskItem,
                                    collections: taskItem.collections.apply(collectionsAction),
                                });
                                break;
                            }
                            case "UpdateStatus": {
                                if (
                                    !state.isChangeTimeReasonable(
                                        taskAction.statusAction.updatedTime,
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `updatedTime` is too far in the future",
                                    );
                                }

                                if (
                                    taskAction.statusAction.value.type === "Closed" &&
                                    !state.isChangeTimeReasonable(
                                        taskAction.statusAction.value.closedTime.absoluteTime,
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `closedTime` is too far in the future",
                                    );
                                }

                                if (
                                    taskAction.statusAction.value.type === "Closed" &&
                                    taskAction.statusAction.value.closer.accountId !==
                                        state.getActorAccountId()
                                ) {
                                    throw new PermissionDeniedError(
                                        "Can only close a task with yourself as the closer",
                                    );
                                }
                                break;
                            }
                            case "UpdateAssignee": {
                                if (
                                    !state.isChangeTimeReasonable(
                                        taskAction.assigneeAction.updatedTime,
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `updatedTime` is too far in the future",
                                    );
                                }

                                if (
                                    taskAction.assigneeAction.value &&
                                    !state.isChangeTimeReasonable(
                                        taskAction.assigneeAction.value.assignedTime.absoluteTime,
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `assignedTime` is too far in the future",
                                    );
                                }

                                if (
                                    taskAction.assigneeAction.value &&
                                    taskAction.assigneeAction.value.assigner.accountId !==
                                        state.getActorAccountId()
                                ) {
                                    throw new PermissionDeniedError(
                                        "Can only assign a task with yourself as the assigner",
                                    );
                                }

                                if (
                                    taskAction.assigneeAction.value &&
                                    !(await state.isAccountMemberOfSpace(
                                        taskAction.assigneeAction.value.assignee.accountId,
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
                                    !state.isChangeTimeReasonable(
                                        taskAction.assigneeStatusAction.updatedTime,
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `updatedTime` is too far in the future",
                                    );
                                }

                                if (
                                    taskAction.assigneeStatusAction.value.type === "Active" &&
                                    !state.isChangeTimeReasonable(
                                        taskAction.assigneeStatusAction.value.activatedTime
                                            .absoluteTime,
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `activatedTime` is too far in the future",
                                    );
                                }

                                if (
                                    taskAction.assigneeStatusAction.value.type === "Active" &&
                                    !state.isChangeTimeReasonable(
                                        taskAction.assigneeStatusAction.value.position.orderTime,
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }
                                break;
                            }
                            case "UpdateTitle": {
                                // Y.js use Lamport timestamps which we don't need to validate for
                                // reasonableness.
                                break;
                            }
                            case "UpdateDueDate": {
                                if (
                                    !state.isChangeTimeReasonable(
                                        taskAction.dueDateAction.updatedTime,
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `updatedTime` is too far in the future",
                                    );
                                }
                                break;
                            }
                            case "UpdatePriority": {
                                if (
                                    !state.isChangeTimeReasonable(
                                        taskAction.priorityAction.updatedTime,
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `updatedTime` is too far in the future",
                                    );
                                }
                                break;
                            }
                            default:
                                throw exhaustive(taskAction);
                        }
                    }
                }
                break;
            }
            case "UpdateTaskCollection": {
                const {collectionId, collectionAction} = action;

                switch (collectionAction.type) {
                    case "Create": {
                        if (collectionAction.creatorId !== state.getActorAccountId()) {
                            throw new PermissionDeniedError(
                                "Can only create a task collection with yourself as the creator",
                            );
                        }

                        if (!state.isChangeTimeReasonable(collectionAction.createdTime)) {
                            throw new InvalidArgumentError(
                                "Action `createdTime` is too far in the future",
                            );
                        }

                        const newCollectionItem: TaskCollectionEssentialAttributesItem = {
                            partitionType: "TaskCollection",
                            sortRangeType: "EssentialAttributes",
                            collectionId,
                            spaceId,
                            creatorId: collectionAction.creatorId,
                            createdTime: collectionAction.createdTime,
                            deletedTime: null,
                            accessPolicy: collectionAction.accessPolicy,
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

                        if (collectionAction.undeletedTime <= collectionItem.deletedTime) {
                            throw new FailedPreconditionError(
                                "Action `undeletedTime` is less than task collection `deletedTime`",
                            );
                        }

                        if (!state.isChangeTimeReasonable(collectionAction.undeletedTime)) {
                            throw new InvalidArgumentError(
                                "Action `undeletedTime` is too far in the future",
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
                                if (collectionAction.deletedTime <= collectionItem.createdTime) {
                                    throw new FailedPreconditionError(
                                        "Action `deletedTime` is less than task collection `createdTime`",
                                    );
                                }

                                if (!state.isChangeTimeReasonable(collectionAction.deletedTime)) {
                                    throw new InvalidArgumentError(
                                        "Action `deletedTime` is too far in the future",
                                    );
                                }

                                await authorizeCollectionAccess(collectionId, "Manage");

                                state.updateCollectionItem({
                                    ...collectionItem,
                                    deletedTime: collectionAction.deletedTime,
                                });
                                break;
                            }
                            case "UpdateName": {
                                if (
                                    !state.isChangeTimeReasonable(
                                        collectionAction.nameAction.updatedTime,
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `updatedTime` is too far in the future",
                                    );
                                }

                                await authorizeCollectionAccess(collectionId, "Manage");
                                break;
                            }
                            case "UpdateAccessPolicy": {
                                if (
                                    !state.isChangeTimeReasonable(
                                        collectionAction.accessPolicyAction.updatedTime,
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `updatedTime` is too far in the future",
                                    );
                                }

                                const accessPolicy = collectionAction.accessPolicyAction.value;

                                if (
                                    iterableEvery(
                                        accessPolicy.accountGrantById.values(),
                                        grant =>
                                            !hasTaskCollectionAccessLevel(grant.level, "Manage"),
                                    ) &&
                                    (accessPolicy.defaultGrant?.type !== "Space" ||
                                        !hasTaskCollectionAccessLevel(
                                            accessPolicy.defaultGrant.level,
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
                                    accessPolicy: collectionItem.accessPolicy.apply(
                                        collectionAction.accessPolicyAction,
                                    ),
                                });
                                break;
                            }
                            case "UpdateTaskPosition": {
                                if (!state.isChangeTimeReasonable(collectionAction.updatedTime)) {
                                    throw new InvalidArgumentError(
                                        "Action `updatedTime` is too far in the future",
                                    );
                                }

                                if (
                                    !state.isChangeTimeReasonable(
                                        collectionAction.position.orderTime,
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `orderTime` is too far in the future",
                                    );
                                }

                                // If you have collection edit access then you implicitly also have task edit
                                // access.
                                await authorizeCollectionAccess(collectionId, "Edit");

                                const taskItem = await state.getTaskItemIfExists(
                                    collectionAction.taskId,
                                );
                                if (!taskItem) throw new NotFoundError("Task not found");

                                if (!taskItem.collections.has(collectionId)) {
                                    throw new FailedPreconditionError("Task is not in collection");
                                }
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
            case "UpdateTaskNotepadPage": {
                const {notepadPageId, notepadPageAction} = action;

                if (action.accountId !== state.getActorAccountId())
                    throw new PermissionDeniedError("Can only access your account's notepad");

                const notepadItem = await state.getActorNotepadItem();

                if (notepadPageAction.type === "Create") {
                    if (notepadItem.pageIds.has(notepadPageId))
                        throw new FailedPreconditionError("Notepad page already exists");

                    const newPageIds = new Set(notepadItem.pageIds);
                    newPageIds.add(notepadPageId);

                    state.updateActorNotepadItem({
                        ...notepadItem,
                        pageIds: newPageIds,
                    });
                } else {
                    if (!notepadItem.pageIds.has(notepadPageId))
                        throw new NotFoundError("Notepad page not found");

                    switch (notepadPageAction.type) {
                        case "AddTask": {
                            if (!state.isChangeTimeReasonable(notepadPageAction.updatedTime)) {
                                throw new InvalidArgumentError(
                                    "Action `updatedTime` is too far in the future",
                                );
                            }

                            if (
                                !state.isChangeTimeReasonable(notepadPageAction.position.orderTime)
                            ) {
                                throw new InvalidArgumentError(
                                    "Action `orderTime` is too far in the future",
                                );
                            }

                            const taskItem = await state.getTaskItemIfExists(
                                notepadPageAction.taskId,
                            );
                            if (!taskItem) throw new NotFoundError("Task not found");

                            await authorizeTaskItemAccess(taskItem, "View");
                            break;
                        }
                        case "RemoveTask": {
                            if (!state.isChangeTimeReasonable(notepadPageAction.updatedTime)) {
                                throw new InvalidArgumentError(
                                    "Action `updatedTime` is too far in the future",
                                );
                            }

                            const taskItem = await state.getTaskItemIfExists(
                                notepadPageAction.taskId,
                            );
                            if (!taskItem) throw new NotFoundError("Task not found");

                            await authorizeTaskItemAccess(taskItem, "View");
                            break;
                        }
                        default:
                            throw exhaustive(notepadPageAction);
                    }
                }
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
