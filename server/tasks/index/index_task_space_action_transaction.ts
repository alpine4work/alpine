import {AppSystemActionContext} from "~/server/dynamo/context/app_action_context.js";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table.js";
import {OpensearchClient} from "~/server/opensearch/opensearch_client.js";
import {applyTaskActionToTaskIndexDoc} from "~/server/tasks/index/apply_task_action_to_task_index_doc.js";
import {TaskCollectionIndex} from "~/server/tasks/index/task_collection_index.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/index/task_collection_index_doc.js";
import {TaskIndex} from "~/server/tasks/index/task_index.js";
import {
    TaskIndexDoc,
    TaskPositionByAccountIdAndNotepadPageId,
    TaskPositionByCollectionIdMap,
} from "~/server/tasks/index/task_index_doc.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {maxHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {
    SpaceId,
    TaskActionTransactionId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {TaskDueDateRegister, TaskParentTaskIdRegister} from "~/shared/tasks/actions/task_action.js";
import {
    TaskSpaceAction,
    getTaskSpaceActionLabel,
} from "~/shared/tasks/actions/task_space_action.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {TaskAssigneeRegister} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneeStatusRegister} from "~/shared/tasks/task_assignee_status.js";
import {TaskCollectionAccessPolicyRegister} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPositionRegister} from "~/shared/tasks/task_position.js";
import {TaskPriorityRegister} from "~/shared/tasks/task_priority.js";
import {TaskStatusRegister} from "~/shared/tasks/task_status.js";
import {emptyTaskTitle} from "~/shared/tasks/task_title.js";

/**
 * Takes a transaction of `TaskSpaceAction`s and indexes them in our OpenSearch
 * task index.
 */
export function indexTaskSpaceActionTransaction(
    context: AppSystemActionContext,
    client: OpensearchClient,
    spaceId: SpaceId,
    actionTransaction: {id: TaskActionTransactionId; actions: ReadonlyArray<TaskSpaceAction>},
) {
    return context.tracer.withSpan("indexTaskSpaceActionTransaction", (context, span) => {
        span.addData({
            tasks: {
                actions: actionTransaction.actions.map(getTaskSpaceActionLabel).join(","),
                actionCount: actionTransaction.actions.length,
                actionTransactionId: actionTransaction.id,
            },
        });

        return TaskSpaceActionTransactionIndexState.index(
            context,
            client,
            spaceId,
            actionTransaction.actions,
        );
    });
}

/**
 * Takes an array of `TaskSpaceAction`s and indexes them in our OpenSearch task
 * action index without needing to first have commit them to DynamoDB.
 *
 * Can only use this function in tests. In production we may only index actions
 * that first have been commit to DynamoDB.
 */
export function indexTaskSpaceActionTransactionWithoutCommitForTest(
    context: AppSystemActionContext,
    client: OpensearchClient,
    spaceId: SpaceId,
    actions: ReadonlyArray<TaskSpaceAction>,
    {onRetry}: {onRetry?: () => void} = {},
) {
    assert(import.meta.jest);
    return TaskSpaceActionTransactionIndexState.index(context, client, spaceId, actions, {onRetry});
}

/**
 * Abstraction for managing state during `indexTaskSpaceActionTransaction()`.
 * We may update a task multiple times in an action transaction but we only
 * want to send one bulk update request to OpenSearch.
 *
 * All reads/writes must go through this class. There is no direct access to
 * the context or OpenSearch. That way the implementation of
 * `indexTaskSpaceActionTransaction()` must use the relevant caches we have
 * in place.
 */
class TaskSpaceActionTransactionIndexState {
    private readonly _context: AppSystemActionContext;
    private readonly _client: OpensearchClient;
    public readonly spaceId: SpaceId;
    public readonly retry: (error?: unknown) => never;

    private readonly _updatedTaskIndexDocById = new Map<TaskId, TaskIndexDoc>();
    private readonly _retrievedTaskIndexDocById = new Map<TaskId, Promise<TaskIndexDoc | null>>();
    private readonly _updatedCollectionIndexDocById = new Map<
        TaskCollectionId,
        TaskCollectionIndexDoc
    >();
    private readonly _retrievedCollectionIndexDocById = new Map<
        TaskCollectionId,
        Promise<TaskCollectionIndexDoc | null>
    >();

    private constructor(
        context: AppSystemActionContext,
        client: OpensearchClient,
        spaceId: SpaceId,
        retry: (error?: unknown) => never,
    ) {
        assert(context.actor.getSpaceId() === spaceId);

        this._context = context;
        this._client = client;
        this.spaceId = spaceId;
        this.retry = retry;
    }

    public static async index(
        context: AppSystemActionContext,
        client: OpensearchClient,
        spaceId: SpaceId,
        actions: ReadonlyArray<TaskSpaceAction>,
        {onRetry}: {onRetry?: () => void} = {},
    ) {
        let hasAlreadyAttempted = false;

        return retryWithExponentialBackoff(async _retry => {
            const isInitialAttempt = !hasAlreadyAttempted;
            hasAlreadyAttempted = true;

            const retry = (error?: unknown) => {
                onRetry?.();
                return _retry(error);
            };

            await authorizeSpaceAccess(context, spaceId);

            const state = new TaskSpaceActionTransactionIndexState(context, client, spaceId, retry);

            for (const action of actions) {
                await actuallyIndexTaskSpaceAction(state, action, isInitialAttempt);
            }

            await runAllPromises([
                state._client.bulkWrite(
                    context,
                    TaskIndex,
                    spaceId,
                    Array.from(state._updatedTaskIndexDocById, ([taskId, task]) => ({
                        type: "IndexIfVersion",
                        id: taskId,
                        doc: task,
                    })),
                    {retryVersionConflictError: retry},
                ),
                state._client.bulkWrite(
                    context,
                    TaskCollectionIndex,
                    spaceId,
                    Array.from(
                        state._updatedCollectionIndexDocById,
                        ([collectionId, collection]) => ({
                            type: "IndexIfVersion",
                            id: collectionId,
                            doc: collection,
                        }),
                    ),
                    {retryVersionConflictError: retry},
                ),
            ]);
        });
    }

    /**
     * Get the `TaskIndexDoc` for the specified `TaskId` and return null if the
     * task doesn't exist.
     */
    public getTaskIndexDocIfExists(taskId: TaskId) {
        // Return the updated doc if we have one. Otherwise we need to load the doc
        // from OpenSearch.
        const updatedTask = this._updatedTaskIndexDocById.get(taskId);
        if (updatedTask) return updatedTask;

        return getOrSetDefaultMapValue(this._retrievedTaskIndexDocById, taskId, async () => {
            const task = await this._client.getDocIfExists(
                this._context,
                TaskIndex,
                this.spaceId,
                taskId,
            );
            if (!task) return null;

            if (task.spaceId !== this.spaceId) throw new FailedPreconditionError("Space mismatch");

            return task;
        });
    }

    /**
     * Updates the `TaskIndexDoc` for the specified `TaskId`.
     *
     * Uses optimistic concurrency control. If the task does not exist then we
     * create it. If the task exists with a different version then we need
     * to retry.
     */
    public putTaskIndexDoc(taskId: TaskId, task: TaskIndexDoc) {
        assert(task.spaceId === this.spaceId);

        const lastTask = this._updatedTaskIndexDocById.get(taskId);

        if (lastTask && !isDeepEqual(lastTask.version, task.version)) {
            throw new InternalError("Expected local task updates to have the same version");
        }

        this._updatedTaskIndexDocById.set(taskId, task);
    }

    /**
     * Get the `TaskCollectionIndexDoc` for the specified `TaskCollectionId` and
     * return null if the collection doesn't exist.
     */
    public getCollectionIndexDocIfExists(collectionId: TaskCollectionId) {
        // Return the updated doc if we have one. Otherwise we need to load the doc
        // from OpenSearch.
        const updatedCollection = this._updatedCollectionIndexDocById.get(collectionId);
        if (updatedCollection) return updatedCollection;

        return getOrSetDefaultMapValue(
            this._retrievedCollectionIndexDocById,
            collectionId,
            async () => {
                const collection = await this._client.getDocIfExists(
                    this._context,
                    TaskCollectionIndex,
                    this.spaceId,
                    collectionId,
                );
                if (!collection) return null;

                if (collection.spaceId !== this.spaceId)
                    throw new FailedPreconditionError("Space mismatch");

                return collection;
            },
        );
    }

    /**
     * Updates the `TaskCollectionIndexDoc` for the specified `TaskCollectionId`.
     *
     * Uses optimistic concurrency control. If the collection does not exist then
     * we create it. If the collection exists with a different version then we need
     * to retry.
     */
    public putCollectionIndexDoc(
        collectionId: TaskCollectionId,
        collection: TaskCollectionIndexDoc,
    ) {
        assert(collection.spaceId === this.spaceId);

        const lastCollection = this._updatedCollectionIndexDocById.get(collectionId);

        if (lastCollection && !isDeepEqual(lastCollection.version, collection.version)) {
            throw new InternalError(
                "Expected local task collection updates to have the same version",
            );
        }

        this._updatedCollectionIndexDocById.set(collectionId, collection);
    }
}

async function actuallyIndexTaskSpaceAction(
    state: TaskSpaceActionTransactionIndexState,
    action: TaskSpaceAction,
    isInitialAttempt: boolean,
) {
    switch (action.type) {
        case "UpdateTask": {
            const oldTask =
                // If this is our initial attempt to create a task then optimistically assume
                // it doesn't exist.
                action.taskAction.type === "Create" && isInitialAttempt
                    ? null
                    : await state.getTaskIndexDocIfExists(action.taskId);

            if (!oldTask && action.taskAction.type === "Create") {
                state.putTaskIndexDoc(action.taskId, {
                    spaceId: state.spaceId,
                    creator: action.taskAction.creator,
                    createdTime: new TaskFilterableTime({
                        absoluteTime: new Date(action.time[0]),
                        setterTimeZone: action.taskAction.creatorTimeZone,
                    }),
                    rawDeletedTime: null,
                    rawUndeletedTime: null,
                    parent: {
                        taskId: new TaskParentTaskIdRegister(null, action.time),
                        position: new TaskPositionRegister(
                            {orderTime: action.time, orderKey: initialOrderKey},
                            action.time,
                        ),
                    },
                    addedChildTaskCount: 0,
                    removedChildTaskCount: 0,
                    addedClosedChildTaskCount: 0,
                    removedClosedChildTaskCount: 0,
                    collections: {
                        raw: {
                            collections: TaskCollectionSet.empty,
                            positionById: TaskPositionByCollectionIdMap.empty,
                        },
                    },
                    notepadPages: {
                        raw: {
                            positionById: TaskPositionByAccountIdAndNotepadPageId.empty,
                        },
                    },
                    status: new TaskStatusRegister({type: "Open"}, action.time),
                    assignee: new TaskAssigneeRegister(null, action.time),
                    rawAssigneeStatus: new TaskAssigneeStatusRegister(
                        {type: "Inactive"},
                        action.time,
                    ),
                    title: {raw: emptyTaskTitle.get()},
                    dueDate: new TaskDueDateRegister(null, action.time),
                    priority: new TaskPriorityRegister(null, action.time),
                });
                return;
            }

            // Retry if we can't find the task. Actions may be applied out of order but a
            // prerequisite for committing an update task action is having seen a create
            // task action. So eventually we expect the task to exist.
            //
            // Another option could be to put the action in some kind of pending queue,
            // wait for the task to be created, then apply tasks from the pending queue but
            // that would have storage costs.
            if (!oldTask) {
                throw state.retry(
                    new InternalError(
                        "Task not found, should not be allowed to commit an update action before a create action",
                    ),
                );
            }

            const newTask = applyTaskActionToTaskIndexDoc(oldTask, action.time, action.taskAction);

            // NOTE(calebmer): Maintaining referential identity to avoid having to make an
            // update network request is an important optimization.
            //
            // In addition to avoiding a network request, this optimization can help avoid
            // some retries too under high contention workloads since it's ok if the doc in
            // OpenSearch has updated from underneath us. The result if we try to reapply
            // would be the same.
            if (newTask !== oldTask) {
                state.putTaskIndexDoc(action.taskId, newTask);
            }
            return;
        }
        case "UpdateTaskCollection": {
            const [oldCollection, oldTaskForUpdateTaskPosition] = await runAllPromises([
                // If this is our initial attempt to create a collection then optimistically
                // assume it doesn't exist.
                action.collectionAction.type === "Create" && isInitialAttempt
                    ? null
                    : state.getCollectionIndexDocIfExists(action.collectionId),

                action.collectionAction.type === "UpdateTaskPosition"
                    ? state.getTaskIndexDocIfExists(action.collectionAction.taskId)
                    : null,
            ]);

            if (!oldCollection && action.collectionAction.type === "Create") {
                state.putCollectionIndexDoc(action.collectionId, {
                    spaceId: state.spaceId,
                    createdTime: new Date(action.time[0]),
                    rawDeletedTime: null,
                    rawUndeletedTime: null,
                    name: new LabelStringRegister("", action.time),
                    accessPolicy: new TaskCollectionAccessPolicyRegister(
                        action.collectionAction.accessPolicy,
                        action.time,
                    ),
                });
                return;
            }

            // Retry if we can't find the collection. Actions may be applied out of order
            // but a prerequisite for committing an update collection action is having seen
            // a create collection action. So eventually we expect the collection to exist.
            if (!oldCollection) {
                throw state.retry(
                    new InternalError(
                        "Task collection not found, should not be allowed to commit an update action before a create action",
                    ),
                );
            }

            switch (action.collectionAction.type) {
                case "Create": {
                    if (oldCollection.createdTime.getTime() !== action.time[0]) {
                        throw new FailedPreconditionError("Incompatible create action");
                    }
                    break;
                }
                case "Delete": {
                    const newRawDeletedTime =
                        oldCollection.rawDeletedTime !== null
                            ? maxHybridLogicalTime(oldCollection.rawDeletedTime, action.time)
                            : action.time;

                    if (newRawDeletedTime !== oldCollection.rawDeletedTime) {
                        state.putCollectionIndexDoc(action.collectionId, {
                            ...oldCollection,
                            rawDeletedTime: newRawDeletedTime,
                        });
                    }
                    break;
                }
                case "Undelete": {
                    const newRawUndeletedTime =
                        oldCollection.rawUndeletedTime !== null
                            ? maxHybridLogicalTime(oldCollection.rawUndeletedTime, action.time)
                            : action.time;

                    if (newRawUndeletedTime !== oldCollection.rawUndeletedTime) {
                        state.putCollectionIndexDoc(action.collectionId, {
                            ...oldCollection,
                            rawUndeletedTime: newRawUndeletedTime,
                        });
                    }
                    break;
                }
                case "UpdateName": {
                    const newName = oldCollection.name.apply({
                        value: action.collectionAction.name,
                        version: action.time,
                    });

                    if (oldCollection.name !== newName) {
                        state.putCollectionIndexDoc(action.collectionId, {
                            ...oldCollection,
                            name: newName,
                        });
                    }
                    break;
                }
                case "UpdateAccessPolicy": {
                    const newAccessPolicy = oldCollection.accessPolicy.apply({
                        value: action.collectionAction.accessPolicy,
                        version: action.time,
                    });

                    if (oldCollection.accessPolicy !== newAccessPolicy) {
                        state.putCollectionIndexDoc(action.collectionId, {
                            ...oldCollection,
                            accessPolicy: newAccessPolicy,
                        });
                    }
                    break;
                }
                case "UpdateTaskPosition": {
                    // Retry if we can't find the task. Actions may be applied out of order but a
                    // prerequisite for committing an update task action is having seen a create
                    // task action. So eventually we expect the task to exist.
                    if (!oldTaskForUpdateTaskPosition) {
                        throw state.retry(
                            new InternalError(
                                "Task not found, should not be allowed to commit an update action before a create action",
                            ),
                        );
                    }

                    const oldTask = oldTaskForUpdateTaskPosition;

                    const newPositionById = oldTask.collections.raw.positionById.apply({
                        type: "Set",
                        key: action.collectionId,
                        value: action.collectionAction.position,
                        version: action.time,
                    });

                    if (newPositionById !== oldTask.collections.raw.positionById) {
                        state.putTaskIndexDoc(action.collectionAction.taskId, {
                            ...oldTask,
                            collections: {
                                raw: {
                                    collections: oldTask.collections.raw.collections,
                                    positionById: newPositionById,
                                },
                            },
                        });
                    }
                    break;
                }
                default:
                    throw exhaustive(action.collectionAction);
            }
            return;
        }
        case "UpdateTaskNotepadPage": {
            if (action.notepadPageAction.type === "Create") {
                // We don't have a notepad page index. That's all stored in a compressed,
                // binary, integer set.
                return;
            }

            const oldTask = await state.getTaskIndexDocIfExists(action.notepadPageAction.taskId);

            // Retry if we can't find the task. Actions may be applied out of order but a
            // prerequisite for committing an update task action is having seen a create
            // task action. So eventually we expect the task to exist.
            if (!oldTask) {
                throw state.retry(
                    new InternalError(
                        "Task not found, should not be allowed to commit an update action before a create action",
                    ),
                );
            }

            switch (action.notepadPageAction.type) {
                case "AddTask": {
                    const newPositionById = oldTask.notepadPages.raw.positionById.apply({
                        type: "Set",
                        key: `${action.accountId}-${action.notepadPageId}`,
                        value: action.notepadPageAction.position,
                        version: action.time,
                    });

                    if (newPositionById !== oldTask.notepadPages.raw.positionById) {
                        state.putTaskIndexDoc(action.notepadPageAction.taskId, {
                            ...oldTask,
                            notepadPages: {
                                raw: {
                                    positionById: newPositionById,
                                },
                            },
                        });
                    }
                    break;
                }
                case "RemoveTask": {
                    const newPositionById = oldTask.notepadPages.raw.positionById.apply({
                        type: "Delete",
                        key: `${action.accountId}-${action.notepadPageId}`,
                        version: action.time,
                    });

                    if (newPositionById !== oldTask.notepadPages.raw.positionById) {
                        state.putTaskIndexDoc(action.notepadPageAction.taskId, {
                            ...oldTask,
                            notepadPages: {
                                raw: {
                                    positionById: newPositionById,
                                },
                            },
                        });
                    }
                    break;
                }
                default:
                    throw exhaustive(action.notepadPageAction);
            }
            return;
        }
        default:
            throw exhaustive(action);
    }
}
