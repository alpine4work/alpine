import {AppSystemActionContext} from "~/server/dynamo/context/app_action_context.js";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module.js";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table.js";
import {
    ActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module_interface.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {TestCounter} from "~/server/helpers/test/test_counter.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {OpensearchIndex} from "~/server/opensearch/opensearch_index.js";
import {
    OpensearchIndexFlattenedKeysType,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {applyTaskActionToTaskIndexDoc} from "~/server/tasks/index/apply_task_action_to_task_index_doc.js";
import {createEmptyTaskIndexDoc} from "~/server/tasks/index/create_empty_task_index_doc.js";
import {getTaskQueryNormalizedFiltersOpensearchQueryClause} from "~/server/tasks/index/internal/get_task_query_normalized_filters_opensearch_query_clause.js";
import {
    convertTaskQuerySortCursorToOpensearchCursor,
    getTaskQueryNormalizedSortsOpensearchSortClause,
} from "~/server/tasks/index/internal/get_task_query_normalized_sorts_opensearch_sort_clause.js";
import {
    TaskCollectionIndexDocType,
    TaskCollectionIndexDocWithVersion,
} from "~/server/tasks/index/task_collection_index_doc.js";
import {TaskIndexDocType, TaskIndexDocWithVersion} from "~/server/tasks/index/task_index_doc.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {maxHybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {TaskCollectionAccessPolicyRegister} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";

// IMPORTANT: Don't export this. All access to the index should be exposed
// through functions in this file. Like how we organize DynamoDB tables. By
// putting all the logic around this index in one file it allows developers to
// carefully control how data is written to this index. Instead of updates
// sprawling out around the codebase.
const TaskIndex = new OpensearchIndex<
    SpaceId,
    TaskId,
    OpensearchIndexTypeType<typeof TaskIndexDocType>,
    OpensearchIndexFlattenedKeysType<typeof TaskIndexDocType>
>(TaskIndexDocType, {
    name: "tasks",
    numberOfShards: 12,
    numberOfRoutingShards: 2 ** 5 * 3 ** 3 * 5,
    // Our searches are basically always within a specific space and basically
    // always exclude deleted tasks. After that tasks exclude closed tasks most
    // of the time and the default sort order for views is creation time.
    //
    // NOCOMMIT: Test that index sorting is working with the profile API?
    // https://www.elastic.co/guide/en/elasticsearch/reference/8.9/search-profile.html
    sort: [
        {field: "spaceId"},
        {field: "isDeleted"},
        {field: "status.value.type"},
        {field: "createdTime.absoluteTime"},
    ],
    // Serving realtime task data is handled by a separate service. So we can
    // afford to slow down our task refresh interval for improved indexing
    // performance.
    refreshInterval: "30s",
});

// IMPORTANT: Don't export this. All access to the index should be exposed
// through functions in this file. Like how we organize DynamoDB tables. By
// putting all the logic around this index in one file it allows developers to
// carefully control how data is written to this index. Instead of updates
// sprawling out around the codebase.
const TaskCollectionIndex = new OpensearchIndex<
    SpaceId,
    TaskCollectionId,
    OpensearchIndexTypeType<typeof TaskCollectionIndexDocType>,
    OpensearchIndexFlattenedKeysType<typeof TaskCollectionIndexDocType>
>(TaskCollectionIndexDocType, {
    name: "task_collections",
    numberOfShards: 3,
    numberOfRoutingShards: 2 ** 5 * 3 ** 3 * 5,
    // Our searches are basically always within a specific space and basically
    // always exclude deleted collections.
    //
    // We need to exclude collections from searches an account doesn't have access
    // to. We can't implement all access rules in OpenSearch but given personal
    // collections are common, as an optimization we include whether a collection
    // is personal or not to efficiently filter them out.
    //
    // Finally sort by `createdTime` since that's generally useful.
    //
    // NOCOMMIT: Test that index sorting is working with the profile API?
    // https://www.elastic.co/guide/en/elasticsearch/reference/8.9/search-profile.html
    sort: [
        {field: "spaceId"},
        {field: "isDeleted"},
        {field: "personalAccessPolicyAccountId"},
        {field: "createdTime"},
    ],
    // We want to see new collections in search in near realtime.
    refreshInterval: "1s",
});

/**
 * Get multiple tasks in parallel as a system actor. System actors have access
 * to all tasks in the space.
 */
export async function getTaskIndexDocsIfExist(
    context: Context<{
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        opensearch: OpensearchContextModule;
        actor: SystemActorContextModule;
    }>,
    spaceId: SpaceId,
    taskIds: ReadonlyArray<TaskId>,
) {
    // We don't verify that the account is allowed to load these documents. We
    // require a system actor with access to the entire space.
    context.actor.authorizeSystem();
    await authorizeSpaceAccess(context, spaceId);

    return context.opensearch.client.multiGetDocsIfExist(
        context.tracer.getTracer(),
        TaskIndex,
        spaceId,
        taskIds,
    );
}

/**
 * Get a task doc from our index but only in tests. This runs no authorization
 * which is why it's not safe to use outside of tests.
 */
export function getTaskIndexDocIfExistsForTest(
    context: Context<{tracer: TracerContextModule; opensearch: OpensearchContextModule}>,
    spaceId: SpaceId,
    taskId: TaskId,
) {
    assert(import.meta.jest);

    return context.opensearch.client.getDocIfExists(
        context.tracer.getTracer(),
        TaskIndex,
        spaceId,
        taskId,
    );
}

/**
 * Get a collection doc from our index but only in tests. This runs no
 * authorization which is why it's not safe to use outside of tests.
 */
export function getTaskCollectionIndexDocIfExistsForTest(
    context: Context<{tracer: TracerContextModule; opensearch: OpensearchContextModule}>,
    spaceId: SpaceId,
    collectionId: TaskCollectionId,
) {
    assert(import.meta.jest);

    return context.opensearch.client.getDocIfExists(
        context.tracer.getTracer(),
        TaskCollectionIndex,
        spaceId,
        collectionId,
    );
}

/**
 * Manually refresh the task index in tests. This means any changes to the task
 * index will be available when searching.
 */
export function refreshTaskIndexForTest(
    context: Context<{tracer: TracerContextModule; opensearch: OpensearchContextModule}>,
) {
    assert(import.meta.jest);

    return context.opensearch.client.refresh(context.tracer.getTracer(), TaskIndex);
}

export const indexTaskActionTransactionTestCheckpoint = new TestCheckpoint<SpaceId>();

/**
 * Takes a transaction of `TaskAction`s and indexes them in our OpenSearch
 * task index. This function assumes the action transaction has been committed
 * but it may not have been!
 *
 * - We sometimes call this in tests without committing to test behavior.
 * - Only `tasks_table.ts` should call this function in production and only
 *   after committing an action transaction, at which point the assumption
 *   is valid.
 */
export function indexTaskActionTransactionAssumingItsCommitted(
    context: AppSystemActionContext,
    spaceId: SpaceId,
    actions: ReadonlyArray<TaskAction>,
    options?: {onRetry?: () => void},
) {
    return TaskActionTransactionIndexState.index(context, spaceId, actions, options);
}

/**
 * Abstraction for managing state during `indexTaskActionTransaction()`.
 * We may update a task multiple times in an action transaction but we only
 * want to send one bulk update request to OpenSearch.
 *
 * All reads/writes must go through this class. There is no direct access to
 * the context or OpenSearch. That way the implementation of
 * `indexTaskActionTransaction()` must use the relevant caches we have
 * in place.
 */
class TaskActionTransactionIndexState {
    private readonly _context: AppSystemActionContext;
    public readonly spaceId: SpaceId;
    public readonly retry: (error?: unknown) => never;

    private readonly _updatedTaskIndexDocById = new Map<TaskId, TaskIndexDocWithVersion>();
    private readonly _retrievedTaskIndexDocById = new Map<
        TaskId,
        Promise<TaskIndexDocWithVersion | null>
    >();
    private readonly _updatedCollectionIndexDocById = new Map<
        TaskCollectionId,
        TaskCollectionIndexDocWithVersion
    >();
    private readonly _retrievedCollectionIndexDocById = new Map<
        TaskCollectionId,
        Promise<TaskCollectionIndexDocWithVersion | null>
    >();

    private constructor(
        context: AppSystemActionContext,
        spaceId: SpaceId,
        retry: (error?: unknown) => never,
    ) {
        assert(context.actor.getSpaceId() === spaceId);

        this._context = context;
        this.spaceId = spaceId;
        this.retry = retry;
    }

    public static async index(
        context: AppSystemActionContext,
        spaceId: SpaceId,
        actions: ReadonlyArray<TaskAction>,
        {onRetry}: {onRetry?: () => void} = {},
    ) {
        let hasAlreadyAttempted = false;

        return retryWithExponentialBackoff(async _retry => {
            await indexTaskActionTransactionTestCheckpoint.waitForTest(spaceId);

            const isInitialAttempt = !hasAlreadyAttempted;
            hasAlreadyAttempted = true;

            const retry = (error?: unknown) => {
                onRetry?.();
                return _retry(error);
            };

            await authorizeSpaceAccess(context, spaceId);

            const state = new TaskActionTransactionIndexState(context, spaceId, retry);

            for (const action of actions) {
                await actuallyIndexTaskAction(state, action, isInitialAttempt);
            }

            await runAllPromises([
                state._context.opensearch.client.bulkWrite(
                    context.tracer.getTracer(),
                    TaskIndex,
                    spaceId,
                    Array.from(state._updatedTaskIndexDocById, ([taskId, task]) => ({
                        type: "IndexIfVersion",
                        id: taskId,
                        doc: task,
                    })),
                    {retryVersionConflictError: retry},
                ),
                state._context.opensearch.client.bulkWrite(
                    context.tracer.getTracer(),
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
            const task = await this._context.opensearch.client.getDocIfExists(
                this._context.tracer.getTracer(),
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
    public putTaskIndexDoc(taskId: TaskId, task: TaskIndexDocWithVersion) {
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
                const collection = await this._context.opensearch.client.getDocIfExists(
                    this._context.tracer.getTracer(),
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
        collection: TaskCollectionIndexDocWithVersion,
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

async function actuallyIndexTaskAction(
    state: TaskActionTransactionIndexState,
    action: TaskAction,
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
                    id: action.taskId,
                    spaceId: state.spaceId,
                    ...createEmptyTaskIndexDoc(action.time, action.taskAction),
                    version: null,
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
                        "Task not found in index, shouldn't be allowed to commit an update action before a create action",
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
                state.putTaskIndexDoc(
                    action.taskId,
                    Object.assign(newTask, {version: oldTask.version}),
                );
            }
            return;
        }
        case "UpdateCollection": {
            // If this is our initial attempt to create a collection then optimistically
            // assume it doesn't exist.
            const oldCollection =
                action.collectionAction.type === "Create" && isInitialAttempt
                    ? null
                    : await state.getCollectionIndexDocIfExists(action.collectionId);

            if (!oldCollection && action.collectionAction.type === "Create") {
                state.putCollectionIndexDoc(action.collectionId, {
                    id: action.collectionId,
                    version: null,
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
                        "Task collection not found in index, shouldn't be allowed to commit an update action before a create action",
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
                default:
                    throw exhaustive(action.collectionAction);
            }
            return;
        }
        case "UpdateNotepadPage": {
            cast<"Create">(action.notepadPageAction.type);
            return;
        }
        default:
            throw exhaustive(action);
    }
}

export const queryTaskIndexTestCounter = new TestCounter<SpaceId>();

/**
 * Query the OpenSearch task index.
 *
 * Remember that the task index will be behind by (hopefully) no more than
 * 2min. So to catch the query up to the actual present result you need to
 * replay ~2min of actions since the query started.
 *
 * Where do we get 2min from?
 * `indexDuration + refreshInterval + refreshDuration` should be less than
 * 2min. What do each of these mean?
 *
 * - `indexDuration`: The time it takes from action transaction commit finish
 *   to action transaction index finish. Basically the duration of
 *   `indexTaskActionTransactionAssumingItsCommitted()`.
 *
 * - `refreshInterval`: The interval at which OpenSearch refreshes its indexes.
 *   For the task index we've configured this to be 30 seconds.
 *
 * - `refreshDuration`: The amount of time it takes to refresh the OpenSearch
 *   index.
 *
 * By default `TaskRealtimeActionHistory` (which is responsible for maintaining
 * our action history in memory) holds the last ~5min of actions. We also
 * timeout searches after 30s.
 *
 * We should eventually set SLAs for task indexing and OpenSearch to avoid
 * weird glitches when we can't fully catch up a query.
 */
export async function queryTaskIndex(
    context: Context<{
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        opensearch: OpensearchContextModule;
        actor: ActorContextModule;
    }>,
    {
        spaceId,
        filters,
        sorts,
        limit,
        afterCursor,
    }: {
        spaceId: SpaceId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        limit: number;
        afterCursor: TaskQuerySortCursor | null;
    },
) {
    // Must be a system actor because we do no filtering to check whether you are
    // allowed to see the queried tasks. Permissions filtering must be done at a
    // different level.
    context.actor.authorizeSystem();

    await authorizeSpaceAccess(context, spaceId);

    queryTaskIndexTestCounter.incrementForTest(spaceId);

    const tasks = await context.opensearch.client.search(
        context.tracer.getTracer(),
        TaskIndex,
        spaceId,
        {
            query: getTaskQueryNormalizedFiltersOpensearchQueryClause(spaceId, filters),
            sort: getTaskQueryNormalizedSortsOpensearchSortClause(sorts),
            size: limit,
            searchAfter: afterCursor
                ? convertTaskQuerySortCursorToOpensearchCursor(sorts, afterCursor)
                : undefined,
        },
    );

    return tasks;
}
