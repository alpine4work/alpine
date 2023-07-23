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
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TaskParentIdRegister} from "~/shared/tasks/actions/task_action.js";
import {TaskSpaceAction, TaskSpaceActionSchema} from "~/shared/tasks/actions/task_space_action.js";
import {
    TaskCollectionAccessLevel,
    TaskCollectionAccessPolicyRegister,
    hasTaskCollectionAccessLevel,
} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";

/**
 * The maximum depth of a child task.
 *
 * This is coincidentally the same as `maxListItemIndentation`.
 */
const maxChildTaskDepth = 5;

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
                        actionTransactionTime: DynamoKeyAttributeSchema.date,

                        /**
                         * An `Id` for uniquely representing an action. Also used to disambiguate
                         * actions with identical `actionTime`s.
                         */
                        actionTransactionId: DynamoKeyAttributeSchema.id(),
                    },
                    attributes: Schema.object({
                        /**
                         * Actions which should always be atomically applied together.
                         */
                        actionTransaction: Schema.array(TaskSpaceActionSchema),
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
                        creatorId: Schema.id<AccountId>(),
                        createdTime: Schema.date,
                        deletedTime: Schema.date.nullable(),
                        parentId: TaskParentIdRegister.schema,
                        collections: TaskCollectionSet.schema,
                    }),
                },
            ],
        },
    ],
});

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
) {
    return context.dynamo.retryTransaction(context =>
        actuallyCommitTaskSpaceActionTransaction(context, spaceId, actionTransaction),
    );
}

async function actuallyCommitTaskSpaceActionTransaction(
    context: AppSessionActionContext,
    spaceId: SpaceId,
    actionTransaction: ReadonlyArray<TaskSpaceAction>,
) {
    await authorizeSpaceAccess(context, spaceId);

    const startTime = new Date();

    const isChangeTimeReasonable = (time: Date) =>
        differenceInHours(time, startTime, {roundingMethod: "floor"}) <= 4;

    // During authorization we may observe some tasks to check if we can write to
    // them. They go in `observedTaskItemById`. We must include them in a
    // `transactionConditionCheck()` to make sure we haven't lost access by the
    // time we go to write.
    //
    // When we execute an action it may update the essential attributes of an item.
    // These updates go in `updatedTaskItemById`. These items we include in a
    // transaction with `transactionDirectlyUpdateItem()`.
    const observedTaskItemById = new Map<TaskId, TaskEssentialAttributesItem | null>();
    const updatedTaskItemById = new Map<TaskId, TaskEssentialAttributesItem>();

    const getTaskItemIfExists = async (
        taskId: TaskId,
    ): Promise<TaskEssentialAttributesItem | null> => {
        const updatedTaskItem = updatedTaskItemById.get(taskId);
        if (updatedTaskItem !== undefined) return updatedTaskItem;

        const observedTaskItem = observedTaskItemById.get(taskId);
        if (observedTaskItem !== undefined) return observedTaskItem;

        const taskItem = await TasksTable.getItemIfExists(context, {
            partitionType: "Task",
            sortRangeType: "EssentialAttributes",
            taskId,
        });
        if (!taskItem) {
            observedTaskItemById.set(taskId, null);
            return null;
        }

        if (taskItem.spaceId !== spaceId) throw new InternalError("Space mismatch");
        observedTaskItemById.set(taskId, taskItem);
        return taskItem;
    };

    // During authorization we may observe some collections to check if we can
    // write to them. However, we may need to load many collections while only one
    // is important for authorizing access. All collections we observe go into
    // `observedCollectionItemById` and any collections we depend on for
    // authorization go in `authorizationDependencyCollectionIds`. At the end we
    // will `transactionConditionCheck()` our authorization dependencies.
    //
    // When we execute an action it may update the essential attributes of an item.
    // These updates go in `updatedCollectionItemById`. These items we include in a
    // transaction with `transactionDirectlyUpdateItem()`.
    const observedCollectionItemById = new Map<
        TaskCollectionId,
        TaskCollectionEssentialAttributesItem | null
    >();
    const updatedCollectionItemById = new Map<
        TaskCollectionId,
        TaskCollectionEssentialAttributesItem
    >();
    const authorizationDependencyCollectionItemById = new Map<
        TaskCollectionId,
        TaskCollectionEssentialAttributesItem | null
    >();

    const getCollectionItemIfExistsWithoutAddingAuthorizationDependency = async (
        collectionId: TaskCollectionId,
    ): Promise<TaskCollectionEssentialAttributesItem | null> => {
        const updatedCollectionItem = updatedCollectionItemById.get(collectionId);
        if (updatedCollectionItem !== undefined) return updatedCollectionItem;

        const observedCollectionItem = observedCollectionItemById.get(collectionId);
        if (observedCollectionItem !== undefined) return observedCollectionItem;

        const collectionItem = await TasksTable.getItemIfExists(context, {
            partitionType: "TaskCollection",
            sortRangeType: "EssentialAttributes",
            collectionId,
        });
        if (!collectionItem) {
            observedCollectionItemById.set(collectionId, null);
            return null;
        }

        if (collectionItem.spaceId !== spaceId) throw new InternalError("Space mismatch");
        observedCollectionItemById.set(collectionId, collectionItem);
        return collectionItem;
    };

    const getCollectionItemIfExists = async (
        collectionId: TaskCollectionId,
    ): Promise<TaskCollectionEssentialAttributesItem | null> => {
        const collectionItem = await getCollectionItemIfExistsWithoutAddingAuthorizationDependency(
            collectionId,
        );

        // If this collection is not an authorization dependency yet, add it.
        if (!authorizationDependencyCollectionItemById.has(collectionId)) {
            const observedCollectionItem = observedCollectionItemById.get(collectionId);
            if (observedCollectionItem !== undefined) {
                authorizationDependencyCollectionItemById.set(collectionId, observedCollectionItem);
            }
        }

        return collectionItem;
    };

    const authorizeTaskItemAccess = async (
        taskItem: TaskEssentialAttributesItem,
        expectedAccessLevel: TaskCollectionAccessLevel,
    ): Promise<void> => {
        // The task creator has an edit access level on their own task.
        if (
            context.actor.getAccountId() === taskItem.creatorId &&
            hasTaskCollectionAccessLevel("Edit", expectedAccessLevel)
        ) {
            return;
        }

        // An array of `TaskCollectionId`s that authorize access to the task or `null`
        // if no `TaskCollectionId`s authorize access to the task.
        const authorizingCollectionItems = await runAllPromises(
            taskItem.collections.getArray().map(async ({collectionId}) => {
                // We don't want to add an authorization dependency on every collection in the
                // task. Only collections we use to pass authorization.
                const collectionItem =
                    await getCollectionItemIfExistsWithoutAddingAuthorizationDependency(
                        collectionId,
                    );
                if (!collectionItem) throw new NotFoundError("Task collection not found");

                const hasAccess = await evaluateTaskCollectionItemAccessPolicy(
                    context,
                    collectionItem,
                    context.actor.getAccountId(),
                    expectedAccessLevel,
                );

                return hasAccess ? collectionItem : null;
            }),
        );

        // We evaluate the access policies for all collections on a task but we only
        // need one passing access policy. We set that access policy as a dependency of
        // our transaction.
        const firstAuthorizingCollectionItem = authorizingCollectionItems.find(isNonNullable);
        if (firstAuthorizingCollectionItem) {
            authorizationDependencyCollectionItemById.set(
                firstAuthorizingCollectionItem.collectionId,
                firstAuthorizingCollectionItem,
            );
            return;
        }

        if (taskItem.parentId.value) {
            const parentTaskItem = await getTaskItemIfExists(taskItem.parentId.value);
            if (!parentTaskItem) throw new NotFoundError("Parent task not found");

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
        const collectionItem = await getCollectionItemIfExists(collectionId);
        if (!collectionItem) throw new NotFoundError("Task collection not found");

        const hasAccess = await evaluateTaskCollectionItemAccessPolicy(
            context,
            collectionItem,
            context.actor.getAccountId(),
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
                const taskItem = await getTaskItemIfExists(taskId);

                switch (taskAction.type) {
                    case "Create": {
                        if (taskItem) throw new FailedPreconditionError("Task already exists");

                        if (taskAction.creator.accountId !== context.actor.getAccountId()) {
                            throw new PermissionDeniedError(
                                "Can only create a task with yourself as the creator",
                            );
                        }

                        if (!isChangeTimeReasonable(taskAction.createdTime.absoluteTime)) {
                            throw new InvalidArgumentError(
                                "Action `createdTime` is too far in the future",
                            );
                        }

                        updatedTaskItemById.set(taskId, {
                            partitionType: "Task",
                            sortRangeType: "EssentialAttributes",
                            taskId,
                            spaceId,
                            creatorId: taskAction.creator.accountId,
                            createdTime: taskAction.createdTime.absoluteTime,
                            deletedTime: null,
                            parentId: new TaskParentIdRegister(
                                null,
                                taskAction.createdTime.absoluteTime,
                            ),
                            collections: TaskCollectionSet.empty,
                        });
                        break;
                    }
                    case "Undelete": {
                        if (!taskItem) throw new NotFoundError("Task not found");
                        if (!taskItem.deletedTime)
                            throw new FailedPreconditionError("Expected task to be deleted");

                        await authorizeTaskItemAccess(taskItem, "Edit");

                        if (taskAction.undeletedTime <= taskItem.deletedTime) {
                            throw new FailedPreconditionError(
                                "Action `undeletedTime` is less than task `deletedTime`",
                            );
                        }

                        if (!isChangeTimeReasonable(taskAction.undeletedTime)) {
                            throw new InvalidArgumentError(
                                "Action `undeletedTime` is too far in the future",
                            );
                        }

                        updatedTaskItemById.set(taskId, {
                            ...taskItem,
                            deletedTime: null,
                        });
                        break;
                    }
                    default: {
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

                                if (!isChangeTimeReasonable(taskAction.deletedTime)) {
                                    throw new InvalidArgumentError(
                                        "Action `deletedTime` is too far in the future",
                                    );
                                }

                                updatedTaskItemById.set(taskId, {
                                    ...taskItem,
                                    deletedTime: taskAction.deletedTime,
                                });
                                break;
                            }
                            case "UpdateTitle": {
                                // Y.js use Lamport timestamps which we don't need to validate for
                                // reasonableness.
                                break;
                            }
                            case "UpdateParent": {
                                if (
                                    !isChangeTimeReasonable(taskAction.parentIdAction.updatedTime)
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `updatedTime` is too far in the future",
                                    );
                                }

                                if (taskAction.parentIdAction.value !== null) {
                                    const parentTaskItem = await getTaskItemIfExists(
                                        taskAction.parentIdAction.value,
                                    );
                                    if (!parentTaskItem)
                                        throw new NotFoundError("Parent task not found");
                                    if (parentTaskItem.deletedTime)
                                        throw new FailedPreconditionError("Parent task is deleted");

                                    // Make sure we have edit access to the parent task in order to make this task
                                    // a child of it.
                                    await authorizeTaskItemAccess(parentTaskItem, "Edit");

                                    let depth = 1;
                                    const seenTaskIds = new Set([taskId, parentTaskItem.taskId]);
                                    let currentParentTaskItem = parentTaskItem;

                                    while (currentParentTaskItem.parentId.value !== null) {
                                        // We don't allow task cycles which would cause infinite looping. If we see
                                        // that updating our `parentId` would create a cycle then error.
                                        //
                                        // Since actions may be applied out of order, clients may temporarily have a
                                        // task cycle. We should be careful about breaking this up on the client.
                                        if (seenTaskIds.has(currentParentTaskItem.parentId.value)) {
                                            throw new FailedPreconditionError(
                                                "Updating task's `parentId` would create a cycle",
                                            );
                                        }

                                        if (depth >= maxChildTaskDepth) {
                                            throw new FailedPreconditionError(
                                                "Maximum child task depth exceeded",
                                            );
                                        }

                                        // NOCOMMIT: Track child task depth so we can enforce depth limit.

                                        // Parent task loading may be cached by our `authorizeTaskItemAccess()`
                                        // call earlier.
                                        const nextParentTaskItem = await getTaskItemIfExists(
                                            currentParentTaskItem.parentId.value,
                                        );
                                        if (!nextParentTaskItem)
                                            throw new NotFoundError("Parent task not found");

                                        depth += 1;
                                        seenTaskIds.add(nextParentTaskItem.taskId);
                                        currentParentTaskItem = nextParentTaskItem;
                                    }
                                }

                                updatedTaskItemById.set(taskId, {
                                    ...taskItem,
                                    parentId: taskItem.parentId.apply(taskAction.parentIdAction),
                                });
                                break;
                            }
                            case "UpdateCollections": {
                                const {collectionsAction} = taskAction;

                                await authorizeCollectionAccess(collectionsAction.key, "Edit");

                                switch (collectionsAction.type) {
                                    case "Set": {
                                        if (
                                            !isChangeTimeReasonable(collectionsAction.updatedTime)
                                        ) {
                                            throw new InvalidArgumentError(
                                                "Action `updatedTime` is too far in the future",
                                            );
                                        }
                                        break;
                                    }
                                    case "Delete": {
                                        if (
                                            !isChangeTimeReasonable(collectionsAction.deletedTime)
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

                                updatedTaskItemById.set(taskId, {
                                    ...taskItem,
                                    collections: taskItem.collections.apply(collectionsAction),
                                });
                                break;
                            }
                            case "UpdateDueDate": {
                                if (!isChangeTimeReasonable(taskAction.dueDateAction.updatedTime)) {
                                    throw new InvalidArgumentError(
                                        "Action `updatedTime` is too far in the future",
                                    );
                                }
                                break;
                            }
                            case "UpdatePriority": {
                                if (
                                    !isChangeTimeReasonable(taskAction.priorityAction.updatedTime)
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
                const collectionItem = await getCollectionItemIfExists(collectionId);

                switch (collectionAction.type) {
                    case "Create": {
                        if (collectionItem)
                            throw new FailedPreconditionError("Task collection already exists");

                        if (collectionAction.creatorId !== context.actor.getAccountId()) {
                            throw new PermissionDeniedError(
                                "Can only create a task collection with yourself as the creator",
                            );
                        }

                        if (!isChangeTimeReasonable(collectionAction.createdTime)) {
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
                            !(await evaluateTaskCollectionItemAccessPolicy(
                                context,
                                newCollectionItem,
                                context.actor.getAccountId(),
                                "Manage",
                            ))
                        ) {
                            throw new InvalidArgumentError(
                                'Must have the "Manage" access level on a collection you create',
                            );
                        }

                        updatedCollectionItemById.set(collectionId, newCollectionItem);
                        break;
                    }
                    case "Undelete": {
                        if (!collectionItem) throw new NotFoundError("Task collection not found");
                        if (!collectionItem.deletedTime)
                            throw new FailedPreconditionError("Expected task to be deleted");

                        await authorizeCollectionAccess(collectionId, "Manage");

                        if (collectionAction.undeletedTime <= collectionItem.deletedTime) {
                            throw new FailedPreconditionError(
                                "Action `undeletedTime` is less than task collection `deletedTime`",
                            );
                        }

                        if (!isChangeTimeReasonable(collectionAction.undeletedTime)) {
                            throw new InvalidArgumentError(
                                "Action `undeletedTime` is too far in the future",
                            );
                        }

                        updatedCollectionItemById.set(collectionId, {
                            ...collectionItem,
                            deletedTime: null,
                        });
                        break;
                    }
                    default: {
                        if (!collectionItem) throw new NotFoundError("Task collection not found");
                        if (collectionItem.deletedTime)
                            throw new FailedPreconditionError("Task collection was deleted");

                        await authorizeCollectionAccess(collectionId, "Manage");

                        switch (collectionAction.type) {
                            case "Delete": {
                                if (collectionAction.deletedTime <= collectionItem.createdTime) {
                                    throw new FailedPreconditionError(
                                        "Action `deletedTime` is less than task collection `createdTime`",
                                    );
                                }

                                if (!isChangeTimeReasonable(collectionAction.deletedTime)) {
                                    throw new InvalidArgumentError(
                                        "Action `deletedTime` is too far in the future",
                                    );
                                }

                                updatedCollectionItemById.set(collectionId, {
                                    ...collectionItem,
                                    deletedTime: collectionAction.deletedTime,
                                });
                                break;
                            }
                            case "UpdateName": {
                                if (
                                    !isChangeTimeReasonable(collectionAction.nameAction.updatedTime)
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `updatedTime` is too far in the future",
                                    );
                                }
                                break;
                            }
                            case "UpdateAccessPolicy": {
                                if (
                                    !isChangeTimeReasonable(
                                        collectionAction.accessPolicyAction.updatedTime,
                                    )
                                ) {
                                    throw new InvalidArgumentError(
                                        "Action `updatedTime` is too far in the future",
                                    );
                                }

                                updatedCollectionItemById.set(collectionId, {
                                    ...collectionItem,
                                    accessPolicy: collectionItem.accessPolicy.apply(
                                        collectionAction.accessPolicyAction,
                                    ),
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
            default:
                throw exhaustive(action);
        }
    }

    const transactionEntries: Array<DynamoTransactionEntry> = [];

    // All observed tasks we treat as authorization dependencies...
    const authorizationDependencyTaskItemById = new Map(observedTaskItemById);

    for (const taskItem of updatedTaskItemById.values()) {
        authorizationDependencyTaskItemById.delete(taskItem.taskId);
        transactionEntries.push(TasksTable.transactionDirectlyUpdateItem(taskItem));
    }

    for (const [taskId, taskItem] of authorizationDependencyTaskItemById) {
        if (!taskItem) {
            transactionEntries.push(
                TasksTable.transactionDoesNotExistConditionCheck({
                    partitionType: "Task",
                    sortRangeType: "EssentialAttributes",
                    taskId,
                }),
            );
        } else {
            transactionEntries.push(
                TasksTable.transactionUpdateLockVersionConditionCheck(
                    {
                        partitionType: "Task",
                        sortRangeType: "EssentialAttributes",
                        taskId,
                    },
                    taskItem.updateLockVersion,
                ),
            );
        }
    }

    for (const collectionItem of updatedCollectionItemById.values()) {
        authorizationDependencyCollectionItemById.delete(collectionItem.collectionId);
        transactionEntries.push(TasksTable.transactionDirectlyUpdateItem(collectionItem));
    }

    for (const [collectionId, collectionItem] of authorizationDependencyCollectionItemById) {
        if (!collectionItem) {
            transactionEntries.push(
                TasksTable.transactionDoesNotExistConditionCheck({
                    partitionType: "TaskCollection",
                    sortRangeType: "EssentialAttributes",
                    collectionId,
                }),
            );
        } else {
            transactionEntries.push(
                TasksTable.transactionUpdateLockVersionConditionCheck(
                    {
                        partitionType: "TaskCollection",
                        sortRangeType: "EssentialAttributes",
                        collectionId,
                    },
                    collectionItem.updateLockVersion,
                ),
            );
        }
    }

    // Actually commit the action transaction once we've verified our authorization
    // dependencies haven't changed...
    transactionEntries.push(
        TaskActionsTable.transactionCreateOrReplaceItem({
            partitionType: "TaskActions",
            sortRangeType: "ActionTransaction",
            spaceId,
            actionTransactionTime: new Date(),
            actionTransactionId: generateId(),
            actionTransaction,
        }),
    );

    await commitTaskSpaceActionTransactionBeforeExecuteTestCheckpoint.waitForTest(
        context.actor.getAccountId(),
    );

    await DynamoTableSchema.executeTransaction(context, transactionEntries);
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
