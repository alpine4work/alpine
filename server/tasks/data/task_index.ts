import {dangerouslyGetAccountIfExistsWithoutCaching} from "~/server/accounts/accounts_table.js";
import {DynamoSystemActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {TestCounter} from "~/server/helpers/test/test_counter.js";
import {JobDescription} from "~/server/jobs/core/job_description.js";
import {
    OpensearchBulkCommandBase,
    OpensearchClient,
    OpensearchClientDocWithId,
    OpensearchClientDocWithIdAndVersion,
    OpensearchGetDocCommand,
    OpensearchIndexDocIfVersionCommand,
} from "~/server/opensearch/opensearch_client.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {OpensearchIndex} from "~/server/opensearch/opensearch_index.js";
import {
    OpensearchIndexTypeFlattenedKeysType,
    OpensearchIndexTypeStoredFieldsType,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {OpensearchQueryValue} from "~/server/opensearch/opensearch_query_clause.js";
import {
    addSearchAffinityEntityActiveTaskAssigneePoints,
    markSearchAffinityEntityInteractionForAccount,
    removeSearchAffinityEntityActiveTaskAssigneePoints,
} from "~/server/search/data/table/search_entity_table.js";
import {authorizeSpaceAccess, getAccount} from "~/server/spaces/spaces_table.js";
import {applyTaskActionToTaskIndexDoc} from "~/server/tasks/data/apply_task_action_to_task_index_doc.js";
import {applyTaskCollectionActionToCollectionIndexDoc} from "~/server/tasks/data/apply_task_collection_action_to_collection_index_doc.js";
import {createEmptyTaskCollectionIndexDoc} from "~/server/tasks/data/create_empty_task_collection_index_doc.js";
import {createEmptyTaskIndexDoc} from "~/server/tasks/data/create_empty_task_index_doc.js";
import {getTaskQueryNormalizedFiltersOpensearchQueryClause} from "~/server/tasks/data/internal/get_task_query_normalized_filters_opensearch_query_clause.js";
import {
    convertTaskQuerySortCursorToOpensearchCursor,
    getTaskQueryNormalizedSortsOpensearchSortClause,
} from "~/server/tasks/data/internal/get_task_query_normalized_sorts_opensearch_sort_clause.js";
import {prepareTaskCollectionForClient} from "~/server/tasks/data/prepare_task_collection_for_client.js";
import {prepareTaskForClient} from "~/server/tasks/data/prepare_task_for_client.js";
import {
    TaskActionContext,
    TaskSessionActionContext,
    TaskSystemActionContext,
} from "~/server/tasks/data/task_action_context.js";
import {
    TaskCollectionIndexActualDoc,
    TaskCollectionIndexDocType,
} from "~/server/tasks/data/task_collection_index_doc.js";
import {
    TaskApproximateActionCountByAccountId,
    TaskIndexActualDoc,
    TaskIndexDocType,
    TaskIndexSearchEntityJob,
    getTaskIndexDocDisplayStatus,
    isTaskIndexDocDeleted,
} from "~/server/tasks/data/task_index_doc.js";
import {getTaskCollectionSearchResultIfExists} from "~/server/tasks/data/task_table.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {FailedPreconditionError, InternalError, NotFoundError} from "~/shared/error/error.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {areHybridLogicalTimesEqual} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {collectReferencedAccountIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_account_ids_from_task_action.js";
import {
    TaskAction,
    TaskUpdateAccountNameAction,
    TaskUpdateTaskAction,
} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskAssigneePositionRegister} from "~/shared/tasks/task_assignee_position.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

const taskIndexRefreshIntervalSeconds = 30;
const taskIndexRefreshIntervalMs = taskIndexRefreshIntervalSeconds * 1000;

// IMPORTANT: Don't export this. All access to the index should be exposed
// through functions in this file. Like how we organize DynamoDB tables. By
// putting all the logic around this index in one file it allows developers to
// carefully control how data is written to this index. Instead of updates
// sprawling out around the codebase.
const TaskIndex = new OpensearchIndex<
    SpaceId,
    TaskId,
    OpensearchIndexTypeType<typeof TaskIndexDocType>,
    OpensearchIndexTypeFlattenedKeysType<typeof TaskIndexDocType>,
    OpensearchIndexTypeStoredFieldsType<typeof TaskIndexDocType>
>(TaskIndexDocType, {
    name: "tasks",
    numberOfShards: 12,
    numberOfRoutingShards: 2 ** 5 * 3 ** 3 * 5,
    // Our searches are basically always within a specific space and basically
    // always exclude deleted tasks. After that tasks exclude closed tasks most
    // of the time and the default sort order for views is creation time.
    sort: [
        {field: "spaceId"},
        {field: "isDeleted"},
        {field: "status.value.type"},
        {field: "createdTime.absoluteTime"},
    ],
    // Serving realtime task data is handled by a separate service. So we can
    // afford to slow down our task refresh interval for improved indexing
    // performance.
    refreshInterval: `${taskIndexRefreshIntervalSeconds}s`,
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
    OpensearchIndexTypeFlattenedKeysType<typeof TaskCollectionIndexDocType>,
    OpensearchIndexTypeStoredFieldsType<typeof TaskCollectionIndexDocType>
>(TaskCollectionIndexDocType, {
    name: "task_collections",
    numberOfShards: 3,
    numberOfRoutingShards: 2 ** 5 * 3 ** 3 * 5,
    // Our searches are basically always within a specific space and basically
    // always exclude deleted collections.
    //
    // Finally sort by `createdTime` since that's generally useful.
    sort: [{field: "spaceId"}, {field: "isDeleted"}, {field: "createdTime"}],
    // We want to see new collections in search in near realtime.
    //
    // TODO(calebmer): When we search collections via our search entity index
    // instead of the collection index we can increase this to
    // `taskIndexRefreshIntervalSeconds`.
    refreshInterval: "1s",
});

/**
 * The throttle interval for task indexing jobs in seconds. Indexing a
 * task requires reading the entire thing and saving it to OpenSearch which
 * can be expensive. Given how frequently users update tasks, we throttle
 * how frequently a task is indexed.
 *
 * When the user first makes an edit to a task we queue an indexing job
 * with this delay. If the user makes an update to the task before the
 * delay has passed then we don't index again. Since when the indexing job
 * finally runs, the update will be picked up. If the user makes an update after
 * the delay has passed then we schedule another indexing job with a new delay.
 *
 * We throttle updates to every 10 seconds for the first ~10 minutes of
 * continuous editing to a task (the first 60 indexes). Then after that we
 * throttle updates to once every 60 seconds. Reindexing large tasks can be
 * expensive so we use the number of prior indexes as a proxy for how large a
 * task is and slow down indexing once it reaches a certain threshold.
 */
function getTaskIndexSearchEntityJobDelaySeconds(generation: number) {
    // For the first 10 minutes (60 * 10 / 60) update every 10 seconds.
    if (generation <= 60) return 10;

    // After that initial period, update every 60 seconds.
    return 60;
}

/**
 * Ensure our task indexes exist in our local environment. This function is
 * idempotent. You may call it multiple times and it will produce the same
 * response. Only attempts to create the index once per process.
 *
 * If we're in a test that's disabled OpenSearch this is a noop.
 *
 * Throws an error in production.
 */
export async function ensureLocalTaskIndexesIfEnabled(context: TaskActionContext) {
    assert(process.env.NODE_ENV !== "production");

    await runAllPromises([
        context.opensearch.ensureLocalIndexIfEnabled(TaskIndex),
        context.opensearch.ensureLocalIndexIfEnabled(TaskCollectionIndex),
    ]);
}

/**
 * Deploy our task indexes to production.
 *
 * May only be called in a production environment. Should only be called by our
 * deployment scripts.
 */
export async function deployTaskIndexes(tracer: TracerBase, client: OpensearchClient) {
    assert(process.env.NODE_ENV === "production");

    await runAllPromises([
        client.deployIndex(tracer, TaskIndex),
        client.deployIndex(tracer, TaskCollectionIndex),
    ]);
}

/**
 * We added `assigneePosition` on 2025-03-10. This migration makes sure
 * `rawAssigneePosition` and `assigneePosition` exist on every task in
 * OpenSearch.
 */
export async function runIndexTaskInitialAssigneePositionMigrationForTask(
    context: Context<ServerProcessContextModules & {opensearch: OpensearchContextModule}>,
    spaceId: SpaceId,
    taskId: TaskId,
) {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    await retryWithExponentialBackoff(async retry => {
        const task = await context.opensearch.getDocIfExists(TaskIndex, spaceId, taskId);
        if (!task) throw retry(new NotFoundError("Task not found"));

        const newRawAssigneePosition = task.rawAssigneePosition.merge(
            new TaskAssigneePositionRegister(null, task.createdTime.absoluteTime),
        );

        if (task.rawAssigneePosition === newRawAssigneePosition) return;

        const newTask = {
            ...task,
            rawAssigneePosition: newRawAssigneePosition,
        };

        await context.opensearch.indexDocIfVersion(TaskIndex, spaceId, newTask, {
            retryVersionConflictError: retry,
        });
    });
}

/**
 * Get multiple tasks in parallel as a system actor. System actors have access
 * to all tasks in the space.
 */
export async function getTaskIndexDocsIfExist(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        opensearch: OpensearchContextModule;
        actor: SystemActorContextModule;
    }>,
    spaceId: SpaceId,
    taskIds: ReadonlyArray<TaskId>,
): Promise<ReadonlyArray<OpensearchClientDocWithIdAndVersion<TaskId, TaskIndexActualDoc> | null>> {
    // We don't verify that the account is allowed to load these documents. We
    // require a system actor with access to the entire space.
    context.actor.authorizeSystem();
    await authorizeSpaceAccess(context, spaceId);

    return context.opensearch.multiGetDocsIfExist(
        taskIds.map(taskId => new OpensearchGetDocCommand(TaskIndex, spaceId, taskId)),
    );
}

/**
 * Get multiple collections in parallel as a system actor. System actors have
 * access to all collections in the space.
 */
export async function getTaskCollectionIndexDocsIfExist(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        opensearch: OpensearchContextModule;
        actor: SystemActorContextModule;
    }>,
    spaceId: SpaceId,
    collectionIds: ReadonlyArray<TaskCollectionId>,
): Promise<
    ReadonlyArray<OpensearchClientDocWithIdAndVersion<
        TaskCollectionId,
        TaskCollectionIndexActualDoc
    > | null>
> {
    // We don't verify that the account is allowed to load these documents. We
    // require a system actor with access to the entire space.
    context.actor.authorizeSystem();
    await authorizeSpaceAccess(context, spaceId);

    return context.opensearch.multiGetDocsIfExist(
        collectionIds.map(
            collectionId => new OpensearchGetDocCommand(TaskCollectionIndex, spaceId, collectionId),
        ),
    );
}

/**
 * Get a task and any referenced tasks/collections from their OpenSearch index.
 * This doesn't rely on an OpenSearch refresh to be up-to-date since we read
 * individual OpenSearch documents.
 *
 * This will give you read-after-write consistency after successful index
 * writes. Not after the `commitTaskActionTransaction()` function which writes
 * to the index in the background.
 */
export async function getTaskFromIndex(
    context: TaskSystemActionContext,
    spaceId: SpaceId,
    taskId: TaskId,
): Promise<{
    task: TaskModel;
    referencedTasks: ReadonlyArray<TaskModel>;
    referencedCollections: ReadonlyArray<TaskCollectionModel>;
    approximateActionCountByAccountId: TaskApproximateActionCountByAccountId;
}> {
    // We don't verify that the account is allowed to load this task. We
    // require a system actor with access to the entire space.
    context.actor.authorizeSystem();
    await authorizeSpaceAccess(context, spaceId);

    const task = await context.opensearch.getDocIfExists(TaskIndex, spaceId, taskId);
    if (!task) throw new NotFoundError("Task not found");

    const approximateActionCountByAccountId = task.approximateActionCountByAccountId;

    const prepareContext = {
        actor: context.actor,
        // We've already authorized our system actor has access to the space.
        isSpaceAccessAuthorized: true,
        // System actors have access to all task collections. So we don't need to
        // evaluate the collection access policy.
        isCollectionAccessAuthorized: async () => true,
    };

    const taskModel = await prepareTaskForClient(task, prepareContext);

    const promiseWaiter = new PromiseWaiter();
    const loadingTaskIds = new Set<TaskId>();
    const loadingCollectionIds = new Set<TaskCollectionId>();

    const rootTaskId = taskId;
    const referencedTaskModels: Array<TaskModel> = [];
    const referencedCollectionModels: Array<TaskCollectionModel> = [];

    const trackTaskDependencies = (task: TaskIndexActualDoc) => {
        const parentTaskId = task.parent.taskId.value;
        if (parentTaskId && parentTaskId !== rootTaskId && !loadingTaskIds.has(parentTaskId)) {
            loadingTaskIds.add(parentTaskId);
            promiseWaiter.waitUntil(async () => {
                const parentTask = await context.opensearch.getDocIfExists(
                    TaskIndex,
                    spaceId,
                    parentTaskId,
                );
                if (!parentTask) throw new NotFoundError("Task not found");

                trackTaskDependencies(parentTask);

                referencedTaskModels.push(await prepareTaskForClient(parentTask, prepareContext));
            });
        }

        for (const {collectionId} of task.collections.raw.collections.getArray()) {
            if (loadingCollectionIds.has(collectionId)) continue;

            loadingCollectionIds.add(collectionId);
            promiseWaiter.waitUntil(async () => {
                const collection = await context.opensearch.getDocIfExists(
                    TaskCollectionIndex,
                    spaceId,
                    collectionId,
                );
                if (!collection) throw new NotFoundError("Task collection not found");

                referencedCollectionModels.push(prepareTaskCollectionForClient(collection));
            });
        }
    };

    trackTaskDependencies(task);

    await promiseWaiter.wait();

    return {
        task: taskModel,
        referencedTasks: referencedTaskModels,
        referencedCollections: referencedCollectionModels,
        approximateActionCountByAccountId,
    };
}

/**
 * Get a task collection from their OpenSearch index. This doesn't rely on an
 * OpenSearch refresh to be up-to-date since we read individual OpenSearch
 * documents.
 *
 * This will give you read-after-write consistency after successful index
 * writes. Not after the `commitTaskActionTransaction()` function which writes
 * to the index in the background.
 */
export async function getTaskCollectionFromIndex(
    context: TaskSystemActionContext,
    spaceId: SpaceId,
    collectionId: TaskCollectionId,
): Promise<TaskCollectionModel> {
    // We don't verify that the account is allowed to load this task. We
    // require a system actor with access to the entire space.
    context.actor.authorizeSystem();
    await authorizeSpaceAccess(context, spaceId);

    const collection = await context.opensearch.getDocIfExists(
        TaskCollectionIndex,
        spaceId,
        collectionId,
    );

    if (!collection) throw new NotFoundError("Task collection not found");

    return prepareTaskCollectionForClient(collection);
}

/**
 * Get a task doc from our index but only in tests. This runs no authorization
 * which is why it's not safe to use outside of tests.
 */
export function getTaskIndexDocIfExistsForTest(
    context: Context<{tracer: TracerContextModule; opensearch: OpensearchContextModule}>,
    spaceId: SpaceId,
    taskId: TaskId,
    options?: {realtime?: boolean},
) {
    assert(process.env.NODE_ENV === "test");

    return context.opensearch.getDocIfExists(TaskIndex, spaceId, taskId, options);
}

/**
 * Get a collection doc from our index but only in tests. This runs no
 * authorization which is why it's not safe to use outside of tests.
 */
export function getTaskCollectionIndexDocIfExistsForTest(
    context: Context<{tracer: TracerContextModule; opensearch: OpensearchContextModule}>,
    spaceId: SpaceId,
    collectionId: TaskCollectionId,
    options?: {realtime?: boolean},
) {
    assert(process.env.NODE_ENV === "test");

    return context.opensearch.getDocIfExists(TaskCollectionIndex, spaceId, collectionId, options);
}

/**
 * Manually refresh the task index in tests. This means any changes to the task
 * index will be available when searching.
 */
export function refreshTaskIndexForTest(
    context: Context<{tracer: TracerContextModule; opensearch: OpensearchContextModule}>,
) {
    assert(import.meta.jest);

    return context.opensearch.refresh(TaskIndex);
}

/**
 * Manually refresh the task collection index in tests. This means any changes
 * to the task index will be available when searching.
 */
export function refreshTaskCollectionIndexForTest(
    context: Context<{tracer: TracerContextModule; opensearch: OpensearchContextModule}>,
) {
    assert(import.meta.jest);

    return context.opensearch.refresh(TaskCollectionIndex);
}

export const indexTaskActionTransactionBeforeUpdateTestCheckpoint = new TestCheckpoint<SpaceId>();
export const indexTaskActionTransactionAfterUpdateTestCheckpoint = new TestCheckpoint<SpaceId>();

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
    context: TaskSystemActionContext,
    spaceId: SpaceId,
    actorId: AccountId | null,
    actions: ReadonlyArray<TaskAction>,
    options?: {onRetry?: () => void},
) {
    const updateAccountNameAction = actions.find(
        (action): action is TaskUpdateAccountNameAction => action.type === "UpdateAccountName",
    );
    if (updateAccountNameAction) {
        if (actions.length !== 1) {
            throw new InternalError(
                "We only support indexing `UpdateAccountName` actions as the one action in a transaction",
            );
        }

        return indexTaskUpdateAccountNameActionAssumingItsCommitted(
            context,
            spaceId,
            updateAccountNameAction,
            options,
        );
    }

    // We don't have a `context.tracer.withSpan()` call here because the one
    // call-site for this function adds a span.
    return TaskActionTransactionIndexState.index(context, spaceId, actorId, actions, options);
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
    private readonly _context: TaskSystemActionContext;
    public readonly spaceId: SpaceId;
    public readonly retry: (error?: unknown) => never;
    private readonly _actionReferencedAccountById: ReadonlyMap<AccountId, AccountModel>;

    private readonly _updatedTaskIndexDocById = new Map<
        TaskId,
        {
            task:
                | OpensearchClientDocWithIdAndVersion<TaskId, TaskIndexActualDoc>
                | Replace<
                      OpensearchClientDocWithIdAndVersion<TaskId, TaskIndexActualDoc>,
                      {lastIndexSearchEntityJob: null}
                  >;
            incrementContinuousApproximateActionCount: number;
            incrementDiscreteApproximateActionCount: number;
        }
    >();
    private readonly _retrievedTaskIndexDocById = new Map<
        TaskId,
        Promise<OpensearchClientDocWithIdAndVersion<TaskId, TaskIndexActualDoc> | null>
    >();
    private readonly _updatedCollectionIndexDocById = new Map<
        TaskCollectionId,
        OpensearchClientDocWithIdAndVersion<TaskCollectionId, TaskCollectionIndexActualDoc>
    >();
    private readonly _retrievedCollectionIndexDocById = new Map<
        TaskCollectionId,
        Promise<OpensearchClientDocWithIdAndVersion<
            TaskCollectionId,
            TaskCollectionIndexActualDoc
        > | null>
    >();

    private constructor(
        context: TaskSystemActionContext,
        spaceId: SpaceId,
        retry: (error?: unknown) => never,
        actionReferencedAccountById: ReadonlyMap<AccountId, AccountModel>,
    ) {
        assert(context.actor.getSpaceId() === spaceId);

        this._context = context;
        this.spaceId = spaceId;
        this.retry = retry;
        this._actionReferencedAccountById = actionReferencedAccountById;
    }

    public static async index(
        context: TaskSystemActionContext,
        spaceId: SpaceId,
        actorId: AccountId | null,
        actions: ReadonlyArray<TaskAction>,
        {onRetry}: {onRetry?: () => void} = {},
    ) {
        const referencedAccountIds = new Set<AccountId>();
        for (const action of actions) {
            collectReferencedAccountIdsFromTaskAction(referencedAccountIds, action);
        }

        // Load all referenced accounts so we can inline them in our OpenSearch index.
        let referencedAccountById = await runAllPromises(
            Array.from(referencedAccountIds, accountId => getAccount(context, spaceId, accountId)),
        ).then(
            referencedAccounts => new Map(referencedAccounts.map(account => [account.id, account])),
        );

        let hasAlreadyAttempted = false;

        return retryWithExponentialBackoff(async _retry => {
            const isInitialAttempt = !hasAlreadyAttempted;
            hasAlreadyAttempted = true;

            const retry = (error?: unknown) => {
                onRetry?.();
                return _retry(error);
            };

            await authorizeSpaceAccess(context, spaceId);

            await indexTaskActionTransactionBeforeUpdateTestCheckpoint.waitForTest(spaceId);

            const state = new TaskActionTransactionIndexState(
                context,
                spaceId,
                retry,
                referencedAccountById,
            );

            for (const action of actions) {
                await actuallyIndexTaskAction(state, action, isInitialAttempt);
            }

            const currentTime = new Date();
            const jobs: Array<{job: JobDescription; delaySeconds?: number}> = [];
            const afterWriteCallbacks: Array<() => Promise<void>> = [];

            const commandPromises = concatIterables<
                Promise<OpensearchBulkCommandBase<typeof TaskIndex | typeof TaskCollectionIndex>>
            >(
                mapIterable(state._updatedTaskIndexDocById.values(), async newTaskEntry => {
                    let newTask = newTaskEntry.task;

                    // Actually increment the approximate action count map in the task:
                    if (
                        actorId !== null &&
                        (newTaskEntry.incrementContinuousApproximateActionCount > 0 ||
                            newTaskEntry.incrementDiscreteApproximateActionCount > 0)
                    ) {
                        const approximateActionCountByAccountId = new Map(
                            newTask.approximateActionCountByAccountId.get(),
                        );

                        let approximateActionCount = approximateActionCountByAccountId.get(
                            actorId,
                        ) ?? {continuousActionCount: 0, discreteActionCount: 0};

                        approximateActionCount = {
                            continuousActionCount:
                                approximateActionCount.continuousActionCount +
                                newTaskEntry.incrementContinuousApproximateActionCount,
                            discreteActionCount:
                                approximateActionCount.discreteActionCount +
                                newTaskEntry.incrementDiscreteApproximateActionCount,
                        };

                        approximateActionCountByAccountId.set(actorId, approximateActionCount);

                        newTask = {
                            ...newTask,
                            approximateActionCountByAccountId:
                                new TaskApproximateActionCountByAccountId(
                                    approximateActionCountByAccountId,
                                ),
                        };
                    }

                    const oldTask = await state._retrievedTaskIndexDocById.get(newTask.id);

                    // We expect `!oldTask` to mean the task is being created. We won't know the
                    // right version number if we didn't read the previous task so our bulk update
                    // will fail if the task is being updated instead of created.
                    if (!oldTask || !newTask.lastIndexSearchEntityJob) {
                        const newIndexSearchEntityJob: TaskIndexSearchEntityJob = {
                            sendTime: currentTime,
                            generation: 0,
                            delaySeconds: getTaskIndexSearchEntityJobDelaySeconds(0),
                            updatedTraits: {type: "Some", traits: []},
                        };

                        newTask = {
                            ...newTask,
                            lastIndexSearchEntityJob: newIndexSearchEntityJob,
                        };

                        jobs.push({
                            delaySeconds: newIndexSearchEntityJob.delaySeconds,
                            job: {
                                type: "IndexSearchEntity",
                                spaceId,
                                update: {
                                    type: "Task",
                                    taskId: newTask.id,
                                    updatedTraits: newIndexSearchEntityJob.updatedTraits,
                                },
                            },
                        });
                    } else {
                        const updatedTraits: Array<"Authorization"> = [];

                        const isCreatorAccountUnchanged =
                            oldTask.creator.accountId === newTask.creator.accountId;

                        const isRawDeletedTimeUnchanged =
                            oldTask.rawDeletedTime === newTask.rawDeletedTime ||
                            (oldTask.rawDeletedTime !== null &&
                                newTask.rawDeletedTime !== null &&
                                areHybridLogicalTimesEqual(
                                    oldTask.rawDeletedTime,
                                    newTask.rawDeletedTime,
                                ));

                        const isRawUndeletedTimeUnchanged =
                            oldTask.rawUndeletedTime === newTask.rawUndeletedTime ||
                            (oldTask.rawUndeletedTime !== null &&
                                newTask.rawUndeletedTime !== null &&
                                areHybridLogicalTimesEqual(
                                    oldTask.rawUndeletedTime,
                                    newTask.rawUndeletedTime,
                                ));

                        const isAssigneeAccountUnchanged =
                            oldTask.assignee.value?.assignee.accountId ===
                            newTask.assignee.value?.assignee.accountId;

                        const areCollectionsUnchanged =
                            oldTask.collections.raw.collections ===
                                newTask.collections.raw.collections ||
                            isDeepEqual(
                                new Set(
                                    oldTask.collections.raw.collections
                                        .getArray()
                                        .map(({collectionId}) => collectionId),
                                ),
                                new Set(
                                    newTask.collections.raw.collections
                                        .getArray()
                                        .map(({collectionId}) => collectionId),
                                ),
                            );

                        const isParentTaskUnchanged =
                            oldTask.parent.taskId.value === newTask.parent.taskId.value;

                        // Any of these individual properties changing could contribute to the task's
                        // `Authorization` trait.
                        //
                        // Deleting a task doesn't change view access to the task but may change view
                        // access to any child tasks.
                        if (
                            !isCreatorAccountUnchanged ||
                            !isRawDeletedTimeUnchanged ||
                            !isRawUndeletedTimeUnchanged ||
                            !isAssigneeAccountUnchanged ||
                            !areCollectionsUnchanged ||
                            !isParentTaskUnchanged
                        ) {
                            updatedTraits.push("Authorization");
                        }

                        const areUpdatedTraitsInLastIndexSearchEntityJob =
                            oldTask.lastIndexSearchEntityJob.updatedTraits.type === "Any" ||
                            (oldTask.lastIndexSearchEntityJob.updatedTraits.type === "Some" &&
                                updatedTraits.every(
                                    trait =>
                                        oldTask.lastIndexSearchEntityJob.updatedTraits.type ===
                                            "Some" &&
                                        oldTask.lastIndexSearchEntityJob.updatedTraits.traits.includes(
                                            trait,
                                        ),
                                ));

                        // Don't add another task index job until after the first one's delay has
                        // finished. When the delayed indexing job runs it will pick up this update.
                        //
                        // Or add another task index job if a trait changed which isn't covered by
                        // the last index job.
                        if (
                            !areUpdatedTraitsInLastIndexSearchEntityJob ||
                            isDatePossiblyLessThanWithUncertaintyWindow(
                                new Date(
                                    oldTask.lastIndexSearchEntityJob.sendTime.getTime() +
                                        oldTask.lastIndexSearchEntityJob.delaySeconds * 1000,
                                ),
                                currentTime,
                            )
                        ) {
                            const newIndexSearchEntityJob: TaskIndexSearchEntityJob = {
                                sendTime: currentTime,
                                generation: oldTask.lastIndexSearchEntityJob.generation + 1,
                                delaySeconds: getTaskIndexSearchEntityJobDelaySeconds(
                                    oldTask.lastIndexSearchEntityJob.generation + 1,
                                ),
                                updatedTraits: {type: "Some", traits: updatedTraits},
                            };

                            newTask = {
                                ...newTask,
                                lastIndexSearchEntityJob: newIndexSearchEntityJob,
                            };

                            jobs.push({
                                delaySeconds: newIndexSearchEntityJob.delaySeconds,
                                job: {
                                    type: "IndexSearchEntity",
                                    spaceId,
                                    update: {
                                        type: "Task",
                                        taskId: newTask.id,
                                        updatedTraits: newIndexSearchEntityJob.updatedTraits,
                                    },
                                },
                            });
                        }
                    }

                    const oldIsActiveForAffinity =
                        oldTask && !isTaskIndexDocDeleted(oldTask)
                            ? getTaskIndexDocDisplayStatus(oldTask) === "OpenActive"
                            : false;
                    const newIsActiveForAffinity = !isTaskIndexDocDeleted(newTask)
                        ? getTaskIndexDocDisplayStatus(newTask) === "OpenActive"
                        : false;

                    // If the active status of the task changes then we want to add/remove affinity
                    // points. Setting a task as active will boost the task to the top of the
                    // account's affinity list. Removing the active status from the task will remove
                    // that boost and take it out of the top of the affinity list.
                    if (
                        oldTask?.assignee.value?.assignee.accountId !==
                            newTask.assignee.value?.assignee.accountId ||
                        oldIsActiveForAffinity !== newIsActiveForAffinity
                    ) {
                        if (
                            oldTask?.assignee.value?.assignee.accountId ===
                            newTask?.assignee.value?.assignee.accountId
                        ) {
                            const assigneeId = oldTask?.assignee.value?.assignee.accountId;
                            if (assigneeId) {
                                if (oldIsActiveForAffinity && !newIsActiveForAffinity) {
                                    afterWriteCallbacks.push(() =>
                                        removeSearchAffinityEntityActiveTaskAssigneePoints(
                                            context,
                                            {
                                                spaceId,
                                                assigneeId,
                                                taskId: newTask.id,
                                            },
                                        ),
                                    );
                                }

                                if (!oldIsActiveForAffinity && newIsActiveForAffinity) {
                                    afterWriteCallbacks.push(() =>
                                        addSearchAffinityEntityActiveTaskAssigneePoints(context, {
                                            spaceId,
                                            assigneeId,
                                            taskId: newTask.id,
                                        }),
                                    );
                                }
                            }
                        } else {
                            const oldAssigneeId = oldTask?.assignee.value?.assignee.accountId;
                            const newAssigneeId = newTask?.assignee.value?.assignee.accountId;

                            if (oldAssigneeId && oldIsActiveForAffinity) {
                                afterWriteCallbacks.push(() =>
                                    removeSearchAffinityEntityActiveTaskAssigneePoints(context, {
                                        spaceId,
                                        assigneeId: oldAssigneeId,
                                        taskId: newTask.id,
                                    }),
                                );
                            }

                            if (newAssigneeId && newIsActiveForAffinity) {
                                afterWriteCallbacks.push(() =>
                                    addSearchAffinityEntityActiveTaskAssigneePoints(context, {
                                        spaceId,
                                        assigneeId: newAssigneeId,
                                        taskId: newTask.id,
                                    }),
                                );
                            }
                        }
                    }

                    // Record an affinity interaction whenever the task is added to a collection for
                    // that collection. Whenever the user chooses a collection from the collections
                    // dropdown we want the collection to rank higher for the next time the user
                    // opens the collections dropdown.
                    //
                    // TODO(calebmer): What happens if we need to reindex OpenSearch from scratch?
                    // Or there's an OpenSearch durability issue and we need to reindex some
                    // actions? Since marking search affinity interactions isn't idempotent we may
                    // end up adding more points than expected. Consider adding a flag to disable
                    // affinity updates when reindexing OpenSearch from scratch.
                    if (actorId !== null) {
                        for (const [
                            collectionId,
                        ] of newTask.collections.raw.collections.entries()) {
                            if (!oldTask?.collections.raw.collections.has(collectionId)) {
                                afterWriteCallbacks.push(() =>
                                    markSearchAffinityEntityInteractionForAccount(context, {
                                        spaceId,
                                        accountId: actorId,
                                        entityId: `TaskCollection:${collectionId}`,
                                        interaction: {type: "LowIntentUpdate"},
                                    }),
                                );
                            }
                        }
                    }

                    return new OpensearchIndexDocIfVersionCommand(TaskIndex, spaceId, newTask);
                }),
                mapIterable(state._updatedCollectionIndexDocById.values(), async newCollection => {
                    const oldCollection = await state._retrievedCollectionIndexDocById.get(
                        newCollection.id,
                    );

                    // We expect `!oldCollection` to mean the collection is being created. We won't
                    // know the right version number if we didn't read the previous collection so
                    // our bulk update will fail if the task is being updated instead of created.
                    if (!oldCollection) {
                        jobs.push({
                            job: {
                                type: "IndexSearchEntity",
                                spaceId,
                                update: {
                                    type: "TaskCollection",
                                    collectionId: newCollection.id,
                                    // Nothing depends on this entity when it's created. Don't bother trying to
                                    // reindex dependencies.
                                    updatedTraits: {type: "None"},
                                },
                            },
                        });
                    } else {
                        const updatedTraits: Array<"Authorization"> = [];

                        const isRawDeletedTimeUnchanged =
                            oldCollection.rawDeletedTime === newCollection.rawDeletedTime ||
                            (oldCollection.rawDeletedTime !== null &&
                                newCollection.rawDeletedTime !== null &&
                                areHybridLogicalTimesEqual(
                                    oldCollection.rawDeletedTime,
                                    newCollection.rawDeletedTime,
                                ));

                        const isRawUndeletedTimeUnchanged =
                            oldCollection.rawUndeletedTime === newCollection.rawUndeletedTime ||
                            (oldCollection.rawUndeletedTime !== null &&
                                newCollection.rawUndeletedTime !== null &&
                                areHybridLogicalTimesEqual(
                                    oldCollection.rawUndeletedTime,
                                    newCollection.rawUndeletedTime,
                                ));

                        const isAccessPolicyUnchanged = isDeepEqual(
                            oldCollection.accessPolicy.value,
                            newCollection.accessPolicy.value,
                        );

                        if (
                            !isRawDeletedTimeUnchanged ||
                            !isRawUndeletedTimeUnchanged ||
                            !isAccessPolicyUnchanged
                        ) {
                            updatedTraits.push("Authorization");
                        }

                        // We reindex collections every time they update, instead of throttling like we
                        // do for tasks. Task may be updated frequently while you're typing in their
                        // titles.
                        jobs.push({
                            job: {
                                type: "IndexSearchEntity",
                                spaceId,
                                update: {
                                    type: "TaskCollection",
                                    collectionId: newCollection.id,
                                    updatedTraits: {type: "Some", traits: updatedTraits},
                                },
                            },
                        });
                    }

                    // Record affinity points when a collection is created.
                    //
                    // TODO(calebmer): What happens if we need to reindex OpenSearch from scratch?
                    // Or there's an OpenSearch durability issue and we need to reindex some
                    // actions? Since marking search affinity interactions isn't idempotent we may
                    // end up adding more points than expected. Consider adding a flag to disable
                    // affinity updates when reindexing OpenSearch from scratch.
                    if (actorId !== null && !oldCollection) {
                        afterWriteCallbacks.push(() =>
                            markSearchAffinityEntityInteractionForAccount(context, {
                                spaceId,
                                accountId: actorId,
                                entityId: `TaskCollection:${newCollection.id}`,
                                interaction: {type: "HighIntentUpdate"},
                            }),
                        );
                    }

                    return new OpensearchIndexDocIfVersionCommand(
                        TaskCollectionIndex,
                        spaceId,
                        newCollection,
                    );
                }),
            );

            const commands = await runAllPromises(commandPromises);

            await state._context.opensearch.bulk(commands, {
                retryPartialVersionConflictError: retry,
            });

            for (const {job, delaySeconds} of jobs) {
                // The search indexing jobs read from the task OpenSearch index. So sending
                // the job after the index write will give us correct write-after-read
                // semantics.
                state._context.jobs.send(job, {delaySeconds});
            }

            // Wait for any registered callbacks to complete (e.g. callbacks that update
            // search affinity for tasks marked as active).
            await runAllPromises(
                afterWriteCallbacks.map(afterWriteCallback => afterWriteCallback()),
            );

            // After we've indexed our data, read all our referenced accounts again but
            // with a strong read consistency. If any referenced account name changed while
            // indexing then we need to re-index our transaction.
            //
            // Account names are not logically a part of a task object in our system, but
            // we do need to inline account names into tasks in OpenSearch so we can sort
            // by account name. We inline account names at indexing time.
            //
            // When an account name updates, we run [update by query][1] to update all
            // previously written account names. However, "previously written" is the
            // operative word. Our update by query can only catch data that finished
            // indexing before the query starts. So what happens to actions that started
            // indexing but have not finished? That's where this check comes into play.
            // When we finish indexing, we check if a name update has occurred. If it has
            // then our transaction might not have been picked up by the update by query so
            // we attempt to re-index.
            //
            // Here's a diagram to visually explain the situation. The following line
            // represents time with events happening on the timeline:
            //
            // ```
            //              Index UpdateAssignee
            //
            //     1. get accounts         4. _bulk writes tasks
            //         ┌─┴──────────────────────────┴───┐
            // ◄──────────────────────────────────────────────────────────────────────────►
            //               │           └───┬────────────────────────┬─┘
            //               │        3. _update_by_query      5. _update_by_query
            //               │          finishes querying         finishes writing
            //        2. account name
            //           updates              Index UpdateAccountName
            // ```
            //
            // This is the edge case we want to prevent with the retry below. We read
            // accounts at 1 which are outdated by the account name update at 2. Then we
            // finish writing our new tasks at 4 (with old inlined data) AFTER
            // `_update_by_query` has searched the tasks to update at 3.
            //
            // The retry will redo 1 and 4 so we write correct data.
            //
            // In practice indexing `UpdateAccountName` also requires us to first wait for
            // an OpenSearch index refresh which is currently configured to be 30s long. So
            // this edge case happens if 4 is written after the refresh 3 observes. Our
            // example is simplified to not consider index refreshing.
            //
            // [1]: https://opensearch.org/docs/latest/api-reference/document-apis/update-by-query/
            {
                const newReferencedAccountById = await runAllPromises(
                    Array.from(referencedAccountIds, accountId =>
                        dangerouslyGetAccountIfExistsWithoutCaching(context, accountId, {
                            // Avoid our account cache to get the latest account model. Ok to get these
                            // accounts without authorization since we call `getAccount()` for these same
                            // accounts earlier which will perform authorization.
                            consistency: "Strong",
                        }),
                    ),
                ).then(
                    referencedAccounts =>
                        new Map(
                            referencedAccounts.map(account => {
                                assert(account);
                                return [account.id, account];
                            }),
                        ),
                );

                if (
                    !iterableEvery(
                        referencedAccountIds,
                        accountId =>
                            referencedAccountById.get(accountId)!.initialData.nameVersion ===
                            newReferencedAccountById.get(accountId)!.initialData.nameVersion,
                    )
                ) {
                    referencedAccountById = new Map(
                        mapIterable(referencedAccountById, ([accountId, account]) => [
                            accountId,
                            account.mergeWithoutSpace(newReferencedAccountById.get(accountId)!),
                        ]),
                    );
                    retry();
                }
            }

            await indexTaskActionTransactionAfterUpdateTestCheckpoint.waitForTest(spaceId);
        });
    }

    /**
     * Gets the name of an `AccountId` referenced by one of the `TaskAction`s we're
     * indexing. Referenced accounts are determined by
     * `collectReferencedAccountIdsFromTaskAction()`. If the account is not
     * referenced then we'll throw an error.
     */
    public getActionReferencedSortableAccount(accountId: AccountId): TaskSortableAccount {
        const account = this._actionReferencedAccountById.get(accountId);

        if (!account) {
            throw new InternalError(
                "Expected account referenced by task action to be available while indexing action",
            );
        }

        return {
            accountId,
            workingAccountName: account.initialData.name,
            workingAccountNameVersion: account.initialData.nameVersion,
        };
    }

    /**
     * Get the `TaskIndexDoc` for the specified `TaskId` and return null if the
     * task doesn't exist.
     */
    public getTaskIndexDocIfExists(taskId: TaskId) {
        // Return the updated doc if we have one. Otherwise we need to load the doc
        // from OpenSearch.
        const updatedTaskEntry = this._updatedTaskIndexDocById.get(taskId);
        if (updatedTaskEntry) return updatedTaskEntry.task;

        return getOrSetDefaultMapValue(this._retrievedTaskIndexDocById, taskId, async () => {
            const task = await this._context.opensearch.getDocIfExists(
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
    public putTaskIndexDoc(
        taskId: TaskId,
        task:
            | OpensearchClientDocWithIdAndVersion<TaskId, TaskIndexActualDoc>
            | Replace<
                  OpensearchClientDocWithIdAndVersion<TaskId, TaskIndexActualDoc>,
                  {lastIndexSearchEntityJob: null}
              >,
        {
            incrementApproximateActionCountType,
        }: {
            incrementApproximateActionCountType: "Continuous" | "Discrete" | null;
        },
    ) {
        assert(task.spaceId === this.spaceId);

        let taskEntry = this._updatedTaskIndexDocById.get(taskId);

        if (taskEntry && !isDeepEqual(taskEntry.task.version, task.version)) {
            throw new InternalError("Expected local task updates to have the same version");
        }

        if (!taskEntry) {
            taskEntry = {
                task,
                incrementContinuousApproximateActionCount: 0,
                incrementDiscreteApproximateActionCount: 0,
            };

            this._updatedTaskIndexDocById.set(taskId, taskEntry);
        }

        taskEntry.task = task;

        if (incrementApproximateActionCountType === "Continuous") {
            taskEntry.incrementContinuousApproximateActionCount += 1;
        }

        if (incrementApproximateActionCountType === "Discrete") {
            taskEntry.incrementDiscreteApproximateActionCount += 1;
        }
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
                const collection = await this._context.opensearch.getDocIfExists(
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
        collection: OpensearchClientDocWithIdAndVersion<
            TaskCollectionId,
            TaskCollectionIndexActualDoc
        >,
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
    // We handle `UpdateAccountName` indexing in
    // `indexTaskActionTransactionAssumingItsCommitted()` instead of here since it
    // needs to update a lot of data.
    assert(action.type !== "UpdateAccountName");

    switch (action.type) {
        case "UpdateTask": {
            const oldTask =
                // If this is our initial attempt to create a task then optimistically assume
                // it doesn't exist.
                action.taskAction.type === "Create" && isInitialAttempt
                    ? null
                    : await state.getTaskIndexDocIfExists(action.taskId);

            if (!oldTask && action.taskAction.type === "Create") {
                const creator = state.getActionReferencedSortableAccount(
                    action.taskAction.creatorId,
                );

                state.putTaskIndexDoc(
                    action.taskId,
                    {
                        id: action.taskId,
                        spaceId: state.spaceId,
                        ...createEmptyTaskIndexDoc(action.time, action.taskAction),
                        creator,
                        version: null,
                        lastIndexSearchEntityJob: null,
                        // `putTaskIndexDoc()` is responsible for adding our action count to this map.
                        approximateActionCountByAccountId:
                            new TaskApproximateActionCountByAccountId(new Map()),
                    },
                    {
                        incrementApproximateActionCountType:
                            getTaskActionApproximateActionCountType(action.taskAction.type),
                    },
                );
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

            const newTask = applyTaskActionToTaskIndexDoc(
                oldTask,
                action.time,
                action.taskAction,
                accountId => state.getActionReferencedSortableAccount(accountId),
            );

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
                    {
                        incrementApproximateActionCountType:
                            getTaskActionApproximateActionCountType(action.taskAction.type),
                    },
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
                    spaceId: state.spaceId,
                    ...createEmptyTaskCollectionIndexDoc(action.time, action.collectionAction),
                    version: null,
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

            const newCollection = applyTaskCollectionActionToCollectionIndexDoc(
                oldCollection,
                action.time,
                action.collectionAction,
            );

            // NOTE(calebmer): Maintaining referential identity to avoid having to make an
            // update network request is an important optimization.
            //
            // In addition to avoiding a network request, this optimization can help avoid
            // some retries too under high contention workloads since it's ok if the doc in
            // OpenSearch has updated from underneath us. The result if we try to reapply
            // would be the same.
            if (newCollection !== oldCollection) {
                state.putCollectionIndexDoc(
                    action.collectionId,
                    Object.assign(newCollection, {version: oldCollection.version}),
                );
            }
            return;
        }
        case "UpdateNotepadPage": {
            return;
        }
        default:
            throw exhaustive(action);
    }
}

function getTaskActionApproximateActionCountType(
    actionType: TaskUpdateTaskAction["taskAction"]["type"],
): "Discrete" | "Continuous" | null {
    switch (actionType) {
        // We don't increment action count for `UpdateChildrenCounts` because it's a
        // system action automatically committed when updating a child task. Child task
        // updates should not count as contribution to the parent task.
        case "UpdateChildrenCounts":
            return null;

        // We don't increment action count for `UpdateAssigneePosition` since it
        // updates private information not observable by anyone but the assigned
        // account.
        case "UpdateAssigneePosition":
            return null;

        case "Create":
        case "Delete":
        case "Undelete":
        case "UpdateParentTaskId":
        case "UpdateParentPosition":
        case "AddCollection":
        case "RemoveCollection":
        case "UpdateCollectionPosition":
        case "UpdateStatus":
        case "UpdateAssignee":
        case "UpdateAssigneeStatus":
        case "UpdateDueDate":
        case "UpdatePriority":
            return "Discrete";

        case "UpdateTitle":
            return "Continuous";

        case "UpdateNotepadPagePosition":
        case "UpdateAssigneeActivePosition":
            return null;

        default:
            throw exhaustive(actionType);
    }
}

export const indexTaskUpdateAccountNameActionBeforeUpdateTestCheckpoint =
    new TestCheckpoint<AccountId>();

export const indexTaskUpdateAccountNameActionAfterUpdateTestCheckpoint =
    new TestCheckpoint<AccountId>();

/**
 * Index an account name update action for a space. Uses the OpenSearch [update
 * by query API][1] to find every `TaskSortableAccount` the account name is
 * referenced in and updates to the latest value. This may take a while to run
 * as queries and bulk updates may be expensive. Then we need to retry on
 * version conflicts as well.
 *
 * As long as this takes less than, say, 5min we're good. So that indexing
 * comfortably completes before the action leaves `TaskRealtimeService`'s
 * action history window.
 *
 * [1]: https://opensearch.org/docs/latest/api-reference/document-apis/update-by-query/
 */
function indexTaskUpdateAccountNameActionAssumingItsCommitted(
    context: TaskSystemActionContext,
    spaceId: SpaceId,
    action: TaskUpdateAccountNameAction,
    {onRetry}: {onRetry?: () => void} = {},
) {
    return context.tracer.withSpan("Index account name update task action", async context => {
        const sortableAccountFields = [
            "creator",
            "status.value.closer",
            "assignee.value.assignee",
            "assignee.value.assigner",
        ] as const;

        let lastUpdateByQueryStartTime: number | null = null;

        // We need to retry until there are no version conflicts...
        await retryWithExponentialBackoff(async _retry => {
            const retry = (error?: unknown) => {
                onRetry?.();
                return _retry(error);
            };

            // Assuming the update account name action has been committed, all future
            // actions that reference an account use the new account name. (Because we read
            // referenced accounts with strong consistency during action indexing.) Before
            // we can update our index we must wait for the index to refresh. After the
            // next refresh we're guaranteed to see (by query) all old account name
            // references. No new account name references will be added so we only need to
            // update the old account name references in this function.
            //
            // We wait the full refresh interval for a refresh to happen. This does mean we
            // trust OpenSearch to refresh on time. We add one extra second of delay as
            // protection against clock skew.
            //
            // `TaskIndex` is currently configured to refresh every 30s. So this is a long
            // delay! We're ok with action indexing taking a while as long as it takes less
            // than ~5min so it fits in our `TaskRealtimeService` action history window
            // (currently configured to be ~10min).
            //
            // In unit tests we force a refresh immediately. Since indexes must be manually
            // refreshed in unit tests (refresh interval set to -1). It's not recommended
            // to force a refresh in production since that could harm index performance.
            //
            // NOTE(calebmer, 2023-09-25): I'm a little worried about update starvation.
            // Let's say there's a client continuously updating a task's title for 10
            // minutes. Our `_update_by_query` will always run into version conflicts since
            // it operates on a potentially stale view of the data. Is this a real problem
            // or only theoretical? I wonder if it makes sense to manually implement
            // `_update_by_query`. We know that no NEW tasks will have the old account name
            // so we only need to update tasks we find from an initial query.
            if (import.meta.jest) {
                await context.opensearch.refresh(TaskIndex);
            } else {
                await context.tracer.withSpan("Waiting for task index to refresh", async () => {
                    await wait(
                        taskIndexRefreshIntervalMs +
                            // 1000ms added to protect against clock skew.
                            1000 -
                            // If we are retrying then subtract the time it took to run our
                            // `updateByQuery()`s. This does assume `updateByQuery()` reads the index at
                            // `lastUpdateByQueryStartTime` which is not quite true. There's some latency
                            // from our service to OpenSearch. We consider our extra 1s enough to cover
                            // that latency. Also if our index is not refreshed we'll get the same version
                            // conflicts and try again.
                            (lastUpdateByQueryStartTime !== null
                                ? Date.now() - lastUpdateByQueryStartTime
                                : 0),
                    );
                });
            }

            lastUpdateByQueryStartTime = Date.now();

            // Double check that we're updating a doc that matches our query. If not then
            // consider this script execution a noop.
            //
            // NOTE(calebmer, 2023-09-25): As I'm adding this, it's unclear to me how docs
            // that are updated but not refreshed work. Does the script get the same doc as
            // what's in the index even if the index isn't refreshed? Or does the script
            // get the live doc?
            const noopConditionExpression = `!(${sortableAccountFields
                .map(sortableAccountField => {
                    const sortableAccountFieldSegments = sortableAccountField.split(".");

                    const existenceCheckExpression = sortableAccountFieldSegments
                        .map(
                            (segment, i) =>
                                `ctx._source.${sortableAccountFieldSegments
                                    .slice(0, i + 1)
                                    .join(".")} != null`,
                        )
                        .join(" && ");

                    return `(${existenceCheckExpression} && ctx._source.${sortableAccountField}.accountId == params.accountId && ctx._source.${sortableAccountField}.workingAccountNameVersion < params.accountNameVersion)`;
                })
                .join(" || ")})`;

            const updateStatements = sortableAccountFields.map(sortableAccountField => {
                const sortableAccountFieldSegments = sortableAccountField.split(".");

                const existenceCheckExpression = sortableAccountFieldSegments
                    .map(
                        (segment, i) =>
                            `ctx._source.${sortableAccountFieldSegments
                                .slice(0, i + 1)
                                .join(".")} != null`,
                    )
                    .join(" && ");

                return `if (${existenceCheckExpression} && ctx._source.${sortableAccountField}.accountId == params.accountId && ctx._source.${sortableAccountField}.workingAccountNameVersion < params.accountNameVersion) { ctx._source.${sortableAccountField}.workingAccountName = params.accountName; ctx._source.${sortableAccountField}.workingAccountNameVersion = params.accountNameVersion }`;
            });

            const script = `if (${noopConditionExpression}) { ctx.op = "noop" } else { ${updateStatements.join(
                " ",
            )} }`;

            await indexTaskUpdateAccountNameActionBeforeUpdateTestCheckpoint.waitForTest(
                action.accountId,
            );

            const {versionConflictCount} = await context.opensearch.updateByQuery(
                TaskIndex,
                spaceId,
                {
                    query: {
                        bool: {
                            // Enter a filter context. Query clauses in a filter context may be cached.
                            // https://opensearch.org/docs/latest/query-dsl/query-filter-context/#filter-context
                            filter: {
                                bool: {
                                    must: [
                                        // Only update tasks in this space:
                                        {term: {spaceId: new OpensearchQueryValue(spaceId)}},

                                        // We want to update deleted tasks in addition to undeleted tasks. Which is why
                                        // we don't have a deleted task filter here.
                                    ],

                                    minimum_should_match: 1,
                                    should: sortableAccountFields.map(sortableAccountField => ({
                                        bool: {
                                            must: [
                                                {
                                                    term: {
                                                        [`${sortableAccountField}.accountId`]:
                                                            new OpensearchQueryValue(
                                                                action.accountId,
                                                            ),
                                                    },
                                                },
                                                {
                                                    range: {
                                                        [`${sortableAccountField}.workingAccountNameVersion`]:
                                                            {
                                                                lt: new OpensearchQueryValue(
                                                                    action.accountNameVersion,
                                                                ),
                                                            },
                                                    },
                                                },
                                            ],
                                        },
                                    })),
                                },
                            },
                        },
                    },
                    script: {
                        lang: "painless",
                        source: script,
                        params: {
                            accountId: action.accountId,
                            accountNameVersion: action.accountNameVersion,
                            accountName: action.accountName,
                        },
                    },
                },
            );

            // If there were some version conflicts, retry. We keep retrying until the
            // update successfully completes.
            //
            // An [ElasticSearch team member][1] also recommends waiting for the index to
            // refresh before retrying so updated fields aren't picked up by the query.
            // We're ok if previously updated docs are seen by the retried query because
            // we'll noop those updates in our script.
            //
            // [1]: https://github.com/elastic/elasticsearch/issues/22723#issuecomment-274156818
            if (versionConflictCount > 0) {
                retry();
            }
        });

        await indexTaskUpdateAccountNameActionAfterUpdateTestCheckpoint.waitForTest(
            action.accountId,
        );
    });
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
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        opensearch: OpensearchContextModule;
        actor: DynamoSystemActorContextModule;
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
): Promise<Array<OpensearchClientDocWithId<TaskId, TaskIndexActualDoc>>> {
    // Must be a system actor because we do no filtering to check whether you are
    // allowed to see the queried tasks. Permissions filtering must be done at a
    // different level.
    context.actor.authorizeSystem();

    await authorizeSpaceAccess(context, spaceId);

    queryTaskIndexTestCounter.incrementForTest(spaceId);

    const {hits: tasks} = await context.opensearch.search(TaskIndex, spaceId, {
        query: getTaskQueryNormalizedFiltersOpensearchQueryClause(spaceId, filters),
        sort: getTaskQueryNormalizedSortsOpensearchSortClause(sorts),
        size: limit,
        searchAfter: afterCursor
            ? convertTaskQuerySortCursorToOpensearchCursor(sorts, afterCursor)
            : undefined,
    });

    return tasks;
}

/**
 * Searches our task collection index for collections matching the provided
 * name query.
 */
export async function searchTaskCollections(
    context: TaskSessionActionContext,
    {spaceId, nameQuery, limit}: {spaceId: SpaceId; nameQuery: string; limit: number},
): Promise<Array<TaskCollectionModelSearchResult & {readonly score: number}>> {
    await authorizeSpaceAccess(context, spaceId);

    const {hits} = await context.opensearch.searchWithoutSource(TaskCollectionIndex, spaceId, {
        size: limit,
        sort: [
            "_score",
            // If score is tied, put the newer collections first.
            {createdTime: {order: "desc", missing: "_last"}},
        ],
        query: {
            bool: {
                // Components of our task collection name search implementation:
                //
                // 1. We use the [OpenSearch search-as-you-type field type][1]. This gives us an
                //    extra 2-gram field, 3-gram field, and prefix search optimized field.
                //    2-grams and 3-grams are used to improve search ranking when you use a
                //    sequence of words in the right order. The prefix search optimized field
                //    improves the performance of otherwise slow prefix queries.
                //
                // 2. We use [`match_bool_prefix`][2] as the search operator (as opposed to
                //    [`match_phrase_prefix`][3] or a plain [`match`][4]). This allows us to
                //    match words in any order (`match_phrase_prefix` requires words to be in
                //    order) while letting the last word act as a prefix search. Our 2-gram and
                //    3-gram fields boosts the score when words are in the right order so
                //    they'll show first but correct order is not required. (Actually we use
                //    `multi_match` + `bool_prefix` which performs `match_bool_prefix` on
                //    multiple fields.)
                //
                // 3. In addition to a `match_bool_prefix` we have a plain [`match`][4] with
                //    `fuzziness: "AUTO"`. This allows us to search single word typos since
                //    `match_bool_prefix` doesn't support `fuzziness`. (I'm not sure of the
                //    implementation reason for this.) We downrank this match so typo matches
                //    appear below full text matches.
                //
                // 4. We use a custom analyzer built from the `english` language analyzer plus
                //    the [`word_delimiter_graph`][5] token filter. This filter takes strings
                //    like `"FY2024Q3"` and turns it into the tokens `["FY", "2024", "Q", "3"]`.
                //    Businesses have plenty of identifiers (like this one), by tokenizing
                //    identifiers we allow searches like `"Q3"` to match any identifier
                //    containing that substring.
                //
                // [1]: https://opensearch.org/docs/latest/field-types/supported-field-types/search-as-you-type/
                // [2]: https://opensearch.org/docs/latest/search-plugins/sql/full-text/#match-boolean-prefix
                // [3]: https://opensearch.org/docs/latest/search-plugins/sql/full-text/#match-phrase-prefix
                // [4]: https://opensearch.org/docs/latest/search-plugins/sql/full-text/#match
                // [5]: https://www.elastic.co/guide/en/elasticsearch/reference/current/analysis-word-delimiter-graph-tokenfilter.html
                minimum_should_match: 1,
                should: [
                    {
                        multi_match: {
                            query: new OpensearchQueryValue(nameQuery),
                            type: "bool_prefix",
                            fields: ["name.value", "name.value._2gram", "name.value._3gram"],
                            fuzziness: 0,
                        },
                    },
                    // While `bool_prefix` supports fuzzy search the final term will not be fuzzy
                    // matched. So if there's only one term or the last term is the critical term we
                    // won't be able to fix mispellings.
                    //
                    // Also, fuzzy matching on 2gram or 3gram fields can lead to some odd results
                    // where, because we're fuzzy matching two words, we end up matching a two word
                    // pair which means something completely different.
                    {
                        match: {
                            "name.value": {
                                query: new OpensearchQueryValue(nameQuery),
                                fuzziness: "AUTO",
                                // Reduce the number of fuzzy expansions.
                                prefix_length: 1,
                                // Misspellings should rank lower than proper spellings.
                                boost: 0.5,
                            },
                        },
                    },
                ],

                // Enter a filter context. Query clauses in a filter context may be cached.
                // https://opensearch.org/docs/latest/query-dsl/query-filter-context/#filter-context
                filter: {
                    bool: {
                        must: [
                            // Always filter for non-deleted collections in our space. These filters should
                            // be pretty fast thanks to our OpenSearch index sort.
                            {term: {spaceId: new OpensearchQueryValue(spaceId)}},
                            {term: {isDeleted: new OpensearchQueryValue(false)}},
                        ],

                        minimum_should_match: 1,
                        // Can only search collections the account has access to. So that's collections
                        // where we have an account grant and collections where there's a default grant
                        // of type `Space`.
                        should: [
                            {
                                term: {
                                    accessPolicyDefaultGrantType: new OpensearchQueryValue("Space"),
                                },
                            },
                            {
                                term: {
                                    accessPolicyAccountGrantIds: new OpensearchQueryValue(
                                        context.actor.getAccountId(),
                                    ),
                                },
                            },
                        ],
                    },
                },
            },
        },
    });

    const results = await runAllPromises(
        hits.map(async hit => {
            const result = await getTaskCollectionSearchResultIfExists(context, hit.id);
            if (!result) return null;
            return {...result, score: hit.score};
        }),
    );

    return results.filter(isNonNullable);
}

/**
 * If the action completes successfully then we'll schedule an
 * `IndexSearchEntity` job for the provided `TaskId` if there isn't already a
 * job scheduled for this update.
 *
 * We do no authorization that the `actor` is allowed to access a task. Since
 * this function does not reveal information about the task to the caller or
 * update the task. It only schedules a indexing job which is idempotent and
 * should be run whenever the task changes.
 */
export async function withSendTaskIndexSearchEntityJobIfNeeded<Value>(
    context: TaskSessionActionContext,
    {spaceId, taskId}: {spaceId: SpaceId; taskId: TaskId},
    action: () => Promise<Value>,
): Promise<Value> {
    // If this is a test where OpenSearch is disabled then don't bother trying to
    // schedule a search entity indexing job.
    if (context.opensearch.isDisabledForTest()) {
        assert(process.env.NODE_ENV === "test");
        return action();
    }

    const [value, initialTask] = await runAllPromises([
        action(),
        context.opensearch.getDocIfExists(TaskIndex, spaceId, taskId),
    ]);

    let hasAlreadyAttempted = false;

    await retryWithExponentialBackoff(async retry => {
        const isInitialAttempt = !hasAlreadyAttempted;
        hasAlreadyAttempted = true;

        const task = isInitialAttempt
            ? initialTask
            : await context.opensearch.getDocIfExists(TaskIndex, spaceId, taskId);

        // If we didn't find the task, we may be waiting for it to be created in the
        // index. The index is updated asynchronously after tasks are committed.
        if (!task) {
            throw retry(new InternalError("Task not found in index"));
        }

        const currentTime = new Date();

        // Don't add a task index job until after the first one's delay has finished.
        // When the delayed indexing job runs it will pick up this update.
        if (
            isDatePossiblyLessThanWithUncertaintyWindow(
                new Date(
                    task.lastIndexSearchEntityJob.sendTime.getTime() +
                        task.lastIndexSearchEntityJob.delaySeconds * 1000,
                ),
                currentTime,
            )
        ) {
            // NOTE(calebmer): Updating traits is currently unsupported for this function
            // but should be easy to add.
            const updatedTraits: Array<never> = [];

            const newIndexSearchEntityJob: TaskIndexSearchEntityJob = {
                sendTime: currentTime,
                generation: task.lastIndexSearchEntityJob.generation + 1,
                delaySeconds: getTaskIndexSearchEntityJobDelaySeconds(
                    task.lastIndexSearchEntityJob.generation + 1,
                ),
                updatedTraits: {type: "Some", traits: updatedTraits},
            };

            await context.opensearch.indexDocIfVersion(
                TaskIndex,
                spaceId,
                {
                    ...task,
                    lastIndexSearchEntityJob: newIndexSearchEntityJob,
                },
                {retryVersionConflictError: retry},
            );

            context.jobs.send(
                {
                    type: "IndexSearchEntity",
                    spaceId,
                    update: {
                        type: "Task",
                        taskId,
                        updatedTraits: newIndexSearchEntityJob.updatedTraits,
                    },
                },
                {delaySeconds: newIndexSearchEntityJob.delaySeconds},
            );
        }
    });

    return value;
}
