import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
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
} from "~/server/search/data/table/search_entity_actions.js";
import {
    AuthorizeSpaceAccessContextModules,
    authorizeSpaceAccess,
} from "~/server/spaces/authorize_space_access.js";
import {getAccountWithoutAvatar} from "~/server/spaces/get_account.js";
import {applyTaskActionToTaskIndexDoc} from "~/server/tasks/data/apply_task_action_to_task_index_doc.js";
import {applyTaskCollectionActionToCollectionIndexDoc} from "~/server/tasks/data/apply_task_collection_action_to_collection_index_doc.js";
import {createEmptyTaskCollectionIndexDoc} from "~/server/tasks/data/create_empty_task_collection_index_doc.js";
import {createEmptyTaskIndexDoc} from "~/server/tasks/data/create_empty_task_index_doc.js";
import {
    TaskActivityUpdate,
    getTaskActivityUpdateFromTaskIndexDocs,
} from "~/server/tasks/data/get_task_activity_update_from_task_index_docs.js";
import {applyTaskActivityWindowUpdate} from "~/server/tasks/data/internal/apply_task_activity_window_update.js";
import {getTaskQueryNormalizedFiltersOpensearchQueryClause} from "~/server/tasks/data/internal/get_task_query_normalized_filters_opensearch_query_clause.js";
import {
    convertTaskQuerySortCursorToOpensearchCursor,
    getTaskQueryNormalizedSortsOpensearchSortClause,
} from "~/server/tasks/data/internal/get_task_query_normalized_sorts_opensearch_sort_clause.js";
import {processTaskActivityEntriesByTaskId} from "~/server/tasks/data/internal/process_task_activity_entries_by_task_id.js";
import {TaskActivityEntryChange} from "~/server/tasks/data/internal/task_activity_table.js";
import {prepareTaskCollectionForClient} from "~/server/tasks/data/prepare_task_collection_for_client.js";
import {prepareTaskForClient} from "~/server/tasks/data/prepare_task_for_client.js";
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
import {
    TaskRealtimeActionContext,
    TaskRealtimeSystemActionContext,
} from "~/server/tasks/data/task_realtime_context.js";
import {getSiteIdFromAccessPolicyIfExists} from "~/shared/access/get_site_id_from_access_policy_if_exists.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    DataLossError,
    FailedPreconditionError,
    InternalError,
    NotFoundError,
} from "~/shared/error/error.open_source.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.open_source.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {areUint8ArraysEqual} from "~/shared/helpers/binary/are_uint8_arrays_equal.js";
import {areHybridLogicalTimesEqual} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.open_source.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.open_source.js";
import {TestCounter} from "~/shared/helpers/test/test_counter.js";
import {JsonScalarValue} from "~/shared/helpers/types/json_value.open_source.js";
import {Replace} from "~/shared/helpers/types/replace.open_source.js";
import {TaskActionTransactionId} from "~/shared/id/types/id_types.js";
import {
    AccountId,
    SiteId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {collectReferencedIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_ids_from_task_action.js";
import {
    TaskAction,
    TaskUpdateAccountNameAction,
    TaskUpdateTaskAction,
    getTaskActionLabel,
} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskAssigneeWithSortableAccountRegister} from "~/shared/tasks/task_assignee.js";
import {TaskAssigneePositionRegister} from "~/shared/tasks/task_assignee_position.js";
import {TaskCreator} from "~/shared/tasks/task_creator.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";
import {TaskStatusWithSortableAccountRegister} from "~/shared/tasks/task_status.js";
import {TracerBase} from "~/shared/tracer/tracer_base.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

/**
 * The refresh interval of our task index and task collection index. Since we use
 * OpenSearch serverless we must use the constant refresh interval they provide.
 *
 * > The refresh interval for indexes in vector search collections is approximately
 * > 60 seconds. The refresh interval for indexes in search and time series
 * > collections is approximately 10 seconds.
 *
 * ([Source][1])
 *
 * [1]:
 *     https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-overview.html
 */
const taskIndexRefreshIntervalMs = 10 * 1000;

/**
 * Since we don't have a way to reliably wait for the task index to refresh we wait
 * _three times_ the refresh interval. This should be enough to cover any variance
 * in refresh interval time.
 *
 * Ideally AWS OpenSearch serverless would provide us a `/_wait_for_refresh`
 * endpoint that gives us reliable read-after-write consistency.
 */
export const taskIndexWaitForRefreshDelayMs = taskIndexRefreshIntervalMs * 3;

// IMPORTANT: Don't export this. All access to the index should be exposed through
// functions in this file. Like how we organize DynamoDB tables. By putting all the
// logic around this index in one file it allows developers to carefully control
// how data is written to this index. Instead of updates sprawling out around the
// codebase.
const TaskIndex = new OpensearchIndex<
    SpaceId,
    TaskId,
    OpensearchIndexTypeType<typeof TaskIndexDocType>,
    OpensearchIndexTypeFlattenedKeysType<typeof TaskIndexDocType>,
    OpensearchIndexTypeStoredFieldsType<typeof TaskIndexDocType>
>(TaskIndexDocType, {
    name: "tasks",
    numberOfShards: 4,
    numberOfRoutingShards: 2 ** 5 * 3 ** 3 * 5,
    refreshInterval: `${assertInteger(taskIndexRefreshIntervalMs / 1000)}s`,

    // Our searches are basically always within a specific space and basically always
    // exclude deleted tasks. After that tasks exclude closed tasks most of the time
    // and the default sort order for views is creation time.
    sort: [
        {field: "spaceId"},
        {field: "isDeleted"},
        {field: "status.value.type"},
        {field: "createdTime.absoluteTime"},
    ],
});

// IMPORTANT: Don't export this. All access to the index should be exposed through
// functions in this file. Like how we organize DynamoDB tables. By putting all the
// logic around this index in one file it allows developers to carefully control
// how data is written to this index. Instead of updates sprawling out around the
// codebase.
const TaskCollectionIndex = new OpensearchIndex<
    SpaceId,
    TaskCollectionId,
    OpensearchIndexTypeType<typeof TaskCollectionIndexDocType>,
    OpensearchIndexTypeFlattenedKeysType<typeof TaskCollectionIndexDocType>,
    OpensearchIndexTypeStoredFieldsType<typeof TaskCollectionIndexDocType>
>(TaskCollectionIndexDocType, {
    name: "task_collections",
    numberOfShards: 2,
    numberOfRoutingShards: 2 ** 5 * 3 ** 3 * 5,
    refreshInterval: `${assertInteger(taskIndexRefreshIntervalMs / 1000)}s`,

    // Our searches are basically always within a specific space and basically always
    // exclude deleted collections.
    //
    // Finally sort by `createdTime` since that's generally useful.
    sort: [{field: "spaceId"}, {field: "isDeleted"}, {field: "createdTime"}],
});

function assertInteger(value: number): number {
    assert(Number.isInteger(value));
    return value;
}

/**
 * The throttle interval for task indexing jobs in seconds. Indexing a task
 * requires reading the entire thing and saving it to OpenSearch which can be
 * expensive. Given how frequently users update tasks, we throttle how frequently a
 * task is indexed.
 *
 * When the user first makes an edit to a task we queue an indexing job with this
 * delay. If the user makes an update to the task before the delay has passed then
 * we don't index again. Since when the indexing job finally runs, the update will
 * be picked up. If the user makes an update after the delay has passed then we
 * schedule another indexing job with a new delay.
 *
 * We throttle updates to every 10 seconds for the first ~10 minutes of continuous
 * editing to a task (the first 60 indexes). Then after that we throttle updates to
 * once every 60 seconds. Reindexing large tasks can be expensive so we use the
 * number of prior indexes as a proxy for how large a task is and slow down
 * indexing once it reaches a certain threshold.
 */
function getTaskIndexSearchEntityJobDelaySeconds(generation: number) {
    // For the first 10 minutes (60 \* 10 / 60) update every 10 seconds.
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
export async function ensureLocalTaskIndexesIfEnabled(context: TaskRealtimeActionContext) {
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
export async function deployTaskIndexes(
    tracer: TracerBase,
    client: OpensearchClient,
    signal: AbortSignal,
) {
    assert(process.env.NODE_ENV === "production");

    await runAllPromises([
        client.deployIndex(tracer, TaskIndex, signal),
        client.deployIndex(tracer, TaskCollectionIndex, signal),
    ]);
}

/**
 * We added `assigneePosition` on 2025-03-10. This migration makes sure
 * `rawAssigneePosition` and `assigneePosition` exist on every task in OpenSearch.
 */
export async function runIndexTaskInitialAssigneePositionMigrationForTask(
    context: Context<DynamoContextModules & {opensearch: OpensearchContextModule}>,
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
 * Get multiple tasks in parallel as a system actor. System actors have access to
 * all tasks in the space.
 */
export async function getTaskIndexDocsIfExist(
    context: Context<
        Replace<
            AuthorizeSpaceAccessContextModules,
            {opensearch: OpensearchContextModule; actor: SystemActorContextModule}
        >
    >,
    spaceId: SpaceId,
    taskIds: ReadonlyArray<TaskId>,
): Promise<ReadonlyArray<OpensearchClientDocWithIdAndVersion<TaskId, TaskIndexActualDoc> | null>> {
    // We don't verify that the account is allowed to load these documents. We require
    // a system actor with access to the entire space.
    context.actor.authorizeSystem();
    await authorizeSpaceAccess(context, spaceId);

    const tasks = await context.opensearch.multiGetDocsIfExist(
        taskIds.map(taskId => new OpensearchGetDocCommand(TaskIndex, spaceId, taskId)),
    );

    // Make sure we're only returning tasks from the requested `SpaceId`. OpenSearch
    // only uses `SpaceId` as a routing value to get to the right shard. So it may
    // return tasks from other spaces.
    return tasks.map(task => (task !== null && task.spaceId === spaceId ? task : null));
}

/**
 * Get multiple collections in parallel as a system actor. System actors have
 * access to all collections in the space.
 */
export async function getTaskCollectionIndexDocsIfExist(
    context: Context<
        Replace<
            AuthorizeSpaceAccessContextModules,
            {opensearch: OpensearchContextModule; actor: SystemActorContextModule}
        >
    >,
    spaceId: SpaceId,
    collectionIds: ReadonlyArray<TaskCollectionId>,
): Promise<
    ReadonlyArray<OpensearchClientDocWithIdAndVersion<
        TaskCollectionId,
        TaskCollectionIndexActualDoc
    > | null>
> {
    // We don't verify that the account is allowed to load these documents. We require
    // a system actor with access to the entire space.
    context.actor.authorizeSystem();
    await authorizeSpaceAccess(context, spaceId);

    const collections = await context.opensearch.multiGetDocsIfExist(
        collectionIds.map(
            collectionId => new OpensearchGetDocCommand(TaskCollectionIndex, spaceId, collectionId),
        ),
    );

    // Make sure we're only returning collections from the requested `SpaceId`.
    // OpenSearch only uses `SpaceId` as a routing value to get to the right shard. So
    // it may return collections from other spaces.
    return collections.map(collection =>
        collection !== null && collection.spaceId === spaceId ? collection : null,
    );
}

/**
 * Get a task and any referenced tasks/collections from their OpenSearch index.
 * This doesn't rely on an OpenSearch refresh to be up-to-date since we read
 * individual OpenSearch documents.
 *
 * This will give you read-after-write consistency after successful index writes.
 * Not after the `commitTaskActionTransaction()` function which writes to the index
 * in the background.
 */
export async function getTaskFromIndex(
    context: TaskRealtimeSystemActionContext,
    spaceId: SpaceId,
    taskId: TaskId,
): Promise<{
    task: TaskModel;
    referencedTasks: ReadonlyArray<TaskModel>;
    referencedCollections: ReadonlyArray<TaskCollectionModel>;
    approximateActionCountByAccountId: TaskApproximateActionCountByAccountId;
}> {
    const taskResult = await getTaskFromIndexIfExists(context, spaceId, taskId);
    if (!taskResult) throw new NotFoundError("Task not found");
    return taskResult;
}

/**
 * Get a task and any referenced tasks/collections from their OpenSearch index.
 * This doesn't rely on an OpenSearch refresh to be up-to-date since we read
 * individual OpenSearch documents.
 *
 * This will give you read-after-write consistency after successful index writes.
 * Not after the `commitTaskActionTransaction()` function which writes to the index
 * in the background.
 */
export async function getTaskFromIndexIfExists(
    context: TaskRealtimeSystemActionContext,
    spaceId: SpaceId,
    taskId: TaskId,
): Promise<{
    task: TaskModel;
    referencedTasks: ReadonlyArray<TaskModel>;
    referencedCollections: ReadonlyArray<TaskCollectionModel>;
    approximateActionCountByAccountId: TaskApproximateActionCountByAccountId;
} | null> {
    // We don't verify that the account is allowed to load this task. We require a
    // system actor with access to the entire space.
    context.actor.authorizeSystem();
    await authorizeSpaceAccess(context, spaceId);

    const task = await context.opensearch.getDocIfExists(TaskIndex, spaceId, taskId);
    if (!task) return null;

    // Make sure we're only returning tasks from the requested `SpaceId`. OpenSearch
    // only uses `SpaceId` as a routing value to get to the right shard. So it may
    // return tasks from other spaces.
    if (task.spaceId !== spaceId) return null;

    const approximateActionCountByAccountId = task.approximateActionCountByAccountId;

    const prepareContext = {
        actor: context.actor,
        // We've already authorized our system actor has access to the space.
        isSpaceAccessAuthorized: true,
        // System actors have access to all task collections and sites. So we don't need to
        // evaluate the collection or site access policy.
        isCollectionAccessAuthorized: async () => true,
        isSiteAccessAuthorized: async () => true,
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
 * This will give you read-after-write consistency after successful index writes.
 * Not after the `commitTaskActionTransaction()` function which writes to the index
 * in the background.
 */
export async function getTaskCollectionFromIndex(
    context: TaskRealtimeSystemActionContext,
    spaceId: SpaceId,
    collectionId: TaskCollectionId,
): Promise<TaskCollectionModel> {
    const collection = await getTaskCollectionFromIndexIfExists(context, spaceId, collectionId);
    if (!collection) throw new NotFoundError("Task collection not found");
    return collection;
}

/**
 * Get a task collection from their OpenSearch index. This doesn't rely on an
 * OpenSearch refresh to be up-to-date since we read individual OpenSearch
 * documents.
 *
 * This will give you read-after-write consistency after successful index writes.
 * Not after the `commitTaskActionTransaction()` function which writes to the index
 * in the background.
 */
export async function getTaskCollectionFromIndexIfExists(
    context: TaskRealtimeSystemActionContext,
    spaceId: SpaceId,
    collectionId: TaskCollectionId,
): Promise<TaskCollectionModel | null> {
    // We don't verify that the account is allowed to load this task. We require a
    // system actor with access to the entire space.
    context.actor.authorizeSystem();
    await authorizeSpaceAccess(context, spaceId);

    const collection = await context.opensearch.getDocIfExists(
        TaskCollectionIndex,
        spaceId,
        collectionId,
    );
    if (!collection) return null;

    // Make sure we're only returning collections from the requested `SpaceId`.
    // OpenSearch only uses `SpaceId` as a routing value to get to the right shard. So
    // it may return collections from other spaces.
    if (collection.spaceId !== spaceId) return null;

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
    assert(process.env.NODE_ENV === "test");

    return context.opensearch.refresh(TaskIndex);
}

/**
 * Manually refresh the task collection index in tests. This means any changes to
 * the task index will be available when searching.
 */
export function refreshTaskCollectionIndexForTest(
    context: Context<{tracer: TracerContextModule; opensearch: OpensearchContextModule}>,
) {
    assert(process.env.NODE_ENV === "test");

    return context.opensearch.refresh(TaskCollectionIndex);
}

export const indexTaskActionTransactionBeforeUpdateTestCheckpoint = new TestCheckpoint<SpaceId>();
export const indexTaskActionTransactionBeforeWriteTestCheckpoint = new TestCheckpoint<SpaceId>();
export const indexTaskActionTransactionAfterUpdateTestCheckpoint = new TestCheckpoint<SpaceId>();
export const emitTaskActivityBeforeProjectionTestCheckpoint = new TestCheckpoint<
    TaskId | "Discrete"
>();

/** The action transaction shape the task indexing entry points take. */
export type TaskIndexActionTransaction = {
    spaceId: SpaceId;
    committedTime: Date;
    actionTransactionId: TaskActionTransactionId;
    actions: ReadonlyArray<TaskAction>;
    actor: TaskCreator | null;
};

/**
 * Takes a transaction of `TaskAction`s and indexes them in our OpenSearch task
 * index, then emits task activity from the diffs indexing computed. This function
 * assumes the action transaction has been committed but it may not have been!
 *
 * - We sometimes call this in tests without committing to test behavior.
 * - Only `tasks_table.ts` should call this function in production and only after
 *   committing an action transaction, at which point the assumption is valid.
 */
export function indexTaskActionTransactionAssumingItsCommitted(
    context: ServerSystemActionContext,
    actionTransaction: {
        spaceId: SpaceId;
        committedTime: Date;
        actionTransactionId: TaskActionTransactionId;
        actions: ReadonlyArray<TaskAction>;
        actor: TaskCreator | null;
    },
    options?: {
        withoutSearchAffinityEntityInteraction?: boolean;
        maxRetryAttemptCount?: number;
    },
) {
    return context.tracer.withSpan("Index task action transaction", async (context, span) => {
        const state = await indexTaskActionTransactionInternal(
            context,
            span,
            actionTransaction,
            options,
        );
        if (state === null) return;

        // NOTE(ifitzsimmons, 2026-08-02): We emit task activity here because this is the
        // only place where all before/after diffs exist (via the index doc). The
        // `wasProcessed` (see `processTaskActionTransaction`) sweeper is the shared retry
        // for both indexing and emission. It's outside the `DataLossError` boundary
        // indexing runs in, because that boundary classifies failures as _search_ data
        // loss, which pages. A failed activity write isn't data loss, the `wasProcessed`
        // sweeper re-runs emission and the feed row just lands late.
        await emitTaskActivityFromIndexAttempt(context, state, {
            spaceId: actionTransaction.spaceId,
            actor: actionTransaction.actor,
            actionTransactionId: actionTransaction.actionTransactionId,
        });
    });
}

/**
 * Variant of `indexTaskActionTransactionAssumingItsCommitted()` that skips task
 * activity emission, for migrations that replay historical action transactions
 * through indexing. Replayed transactions apply to the index as noops, which would
 * otherwise trigger the activity crash-recovery fallback and flood feeds with
 * `Unknown`-initial entries for all of history.
 *
 * Skipping activity is also what lets this variant accept the narrower realtime
 * context migrations run with: the activity engine writes realtime events
 * (`RynamoTableSchema`) which need the full server context, indexing itself
 * doesn't.
 */
export function indexTaskActionTransactionWithoutActivityAssumingItsCommitted(
    context: TaskRealtimeSystemActionContext,
    actionTransaction: TaskIndexActionTransaction,
    options?: {
        withoutSearchAffinityEntityInteraction?: boolean;
        maxRetryAttemptCount?: number;
    },
) {
    return context.tracer.withSpan("Index task action transaction", async (context, span) => {
        await indexTaskActionTransactionInternal(context, span, actionTransaction, options);
    });
}

/**
 * The shared indexing body of both entry points: span data, the test bail-out, and
 * the `DataLossError` escalation. Returns the final attempt's state so the
 * activity entry point can emit from its diffs, or null when there's nothing to
 * emit from (OpenSearch disabled in tests, account name transactions).
 */
async function indexTaskActionTransactionInternal(
    context: TaskRealtimeSystemActionContext,
    span: TracerSpan,
    actionTransaction: TaskIndexActionTransaction,
    options?: {
        withoutSearchAffinityEntityInteraction?: boolean;
        maxRetryAttemptCount?: number;
    },
): Promise<TaskActionTransactionIndexState | null> {
    span.addData({
        tasks: {
            actions: actionTransaction.actions.map(getTaskActionLabel).join(","),
            actionCount: actionTransaction.actions.length,
            actionTransactionId: actionTransaction.actionTransactionId,
        },
    });

    // If we're in a unit test where OpenSearch is disabled then don't bother indexing.
    if (process.env.NODE_ENV === "test" && context.opensearch.isDisabledForTest()) return null;

    try {
        return await actuallyIndexTaskActionTransactionAssumingItsCommitted(
            context,
            actionTransaction.spaceId,
            actionTransaction.actor?.accountId ?? null,
            actionTransaction.actions,
            options,
        );
    } catch (error) {
        // Escalate task indexing errors to `DataLossError` since it means we failed to
        // index tasks but the user doesn't know.
        //
        // It would be very bad for the process to shutdown midway through indexing such
        // that we don't see this error! We need some backup monitoring/retry method.
        throw DataLossError.from(error);
    }
}

export async function indexTaskActionTransactionAssumingItsCommittedForTest(
    context: TaskRealtimeSystemActionContext,
    spaceId: SpaceId,
    actorId: AccountId | null,
    actions: ReadonlyArray<TaskAction>,
    options?: {
        onRetry?: () => void;
        /** Caps indexing attempts, for tests exercising retry exhaustion. */
        maxRetryAttemptCount?: number;
        /**
         * Emit task activity from the attempt like production does. Omitting it simulates
         * an attempt that wrote the index docs but crashed before emission.
         */
        activityActionTransaction?: {
            context: ServerSystemActionContext;
            actionTransactionId: TaskActionTransactionId;
        };
    },
) {
    assert(import.meta.jest);

    const state = await actuallyIndexTaskActionTransactionAssumingItsCommitted(
        context,
        spaceId,
        actorId,
        actions,
        {onRetry: options?.onRetry, maxRetryAttemptCount: options?.maxRetryAttemptCount},
    );

    if (options?.activityActionTransaction && state !== null) {
        await emitTaskActivityFromIndexAttempt(options.activityActionTransaction.context, state, {
            spaceId,
            actor: actorId ? {accountId: actorId, from: null} : null,
            actionTransactionId: options.activityActionTransaction.actionTransactionId,
        });
    }
}

async function actuallyIndexTaskActionTransactionAssumingItsCommitted(
    context: TaskRealtimeSystemActionContext,
    spaceId: SpaceId,
    actorId: AccountId | null,
    actions: ReadonlyArray<TaskAction>,
    options?: {
        maxRetryAttemptCount?: number;
        onRetry?: () => void;
    },
): Promise<TaskActionTransactionIndexState | null> {
    const updateAccountNameAction = actions.find(
        (action): action is TaskUpdateAccountNameAction => action.type === "UpdateAccountName",
    );
    if (updateAccountNameAction) {
        if (actions.length !== 1) {
            throw new InternalError(
                "We only support indexing `UpdateAccountName` actions as the one action in a transaction",
            );
        }

        await indexTaskUpdateAccountNameActionAssumingItsCommitted(
            context,
            spaceId,
            updateAccountNameAction,
        );
        // Account name updates never produce activity.
        return null;
    }

    // We don't have a `context.tracer.withSpan()` call here because the one call-site
    // for this function adds a span.
    return await TaskActionTransactionIndexState.index(context, spaceId, actorId, actions, options);
}

/**
 * Abstraction for managing state during `indexTaskActionTransaction()`. We may
 * update a task multiple times in an action transaction but we only want to send
 * one bulk update request to OpenSearch.
 *
 * All reads/writes must go through this class. There is no direct access to the
 * context or OpenSearch. That way the implementation of
 * `indexTaskActionTransaction()` must use the relevant caches we have in place.
 */
class TaskActionTransactionIndexState {
    private readonly _context: TaskRealtimeSystemActionContext;
    public readonly spaceId: SpaceId;
    public readonly retry: (error?: unknown) => never;
    private readonly _actionReferencedAccountById: ReadonlyMap<
        AccountId,
        Omit<AccountModelData, "avatar">
    >;

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

    // The emit-ready activity payloads this attempt's doc applications produced, in
    // action order. Suppressed and non-activity-bearing actions record nothing (see
    // `getTaskActivityUpdateFromTaskIndexDocs()` for the policy). A fresh state per
    // attempt means payloads never leak across retries; only the winning attempt's
    // state reaches emission.
    private readonly _activityUpdates: Array<{
        taskId: TaskId;
        update: TaskActivityUpdate;
    }> = [];
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
        context: TaskRealtimeSystemActionContext,
        spaceId: SpaceId,
        retry: (error?: unknown) => never,
        actionReferencedAccountById: ReadonlyMap<AccountId, Omit<AccountModelData, "avatar">>,
    ) {
        assert(context.actor.getSpaceId() === spaceId);

        this._context = context;
        this.spaceId = spaceId;
        this.retry = retry;
        this._actionReferencedAccountById = actionReferencedAccountById;
    }

    public static async index(
        context: TaskRealtimeSystemActionContext,
        spaceId: SpaceId,
        actorId: AccountId | null,
        actions: ReadonlyArray<TaskAction>,
        {
            withoutSearchAffinityEntityInteraction = false,
            maxRetryAttemptCount,
            onRetry,
        }: {
            withoutSearchAffinityEntityInteraction?: boolean;
            maxRetryAttemptCount?: number;
            onRetry?: () => void;
        } = {},
    ): Promise<TaskActionTransactionIndexState> {
        const referencedAccountIds = new Set<AccountId>();
        // NOTE(ifitzsimmons, 2026-03-12): we don't currently use these referenced site ids
        // anywhere. If we want to support task sorting by site, we'll need to collect them
        // here and implement similar machinery as we do for
        // `TaskIndexSortableAccountType`. However, that's a lot of complexity and
        // engineering effort for a feature that I'm not sure our users will actually want.
        const referencedSiteIds = new Set<SiteId>();
        for (const action of actions) {
            collectReferencedIdsFromTaskAction(referencedAccountIds, referencedSiteIds, action);
        }

        // Load all referenced accounts so we can inline them in our OpenSearch index.
        let referencedAccountById = await runAllPromises(
            Array.from(referencedAccountIds, accountId =>
                getAccountWithoutAvatar(context, spaceId, accountId),
            ),
        ).then(
            referencedAccounts => new Map(referencedAccounts.map(account => [account.id, account])),
        );

        let hasAlreadyAttempted = false;

        // The state of the attempt that won the doc write, captured for activity emission
        // after this loop (see `emitTaskActivityFromIndexAttempt()`).
        let firstCompletedState: TaskActionTransactionIndexState | null = null;

        await retryWithExponentialBackoff(run, {maxAttemptCount: maxRetryAttemptCount});
        assert(firstCompletedState !== null, "A completed index run always records its state");
        return firstCompletedState;

        async function run(_retry: (error?: unknown) => never) {
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
                await applyTaskActionAndCaptureActivity(state, action, isInitialAttempt);
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

                    // We expect `!oldTask` to mean the task is being created. We won't know the right
                    // version number if we didn't read the previous task so our bulk update will fail
                    // if the task is being updated instead of created.
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
                        const updatedTraits: Array<"Authorization" | "Title"> = [];

                        const isAccessPolicyUnchanged =
                            oldTask.accessPolicy?.value === newTask.accessPolicy?.value;

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
                            !isAccessPolicyUnchanged ||
                            !isRawDeletedTimeUnchanged ||
                            !isRawUndeletedTimeUnchanged ||
                            !isAssigneeAccountUnchanged ||
                            !areCollectionsUnchanged ||
                            !isParentTaskUnchanged
                        ) {
                            updatedTraits.push("Authorization");
                        }

                        if (!areUint8ArraysEqual(oldTask.title.raw, newTask.title.raw)) {
                            updatedTraits.push("Title");
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

                        // Don't add another task index job until after the first one's delay has finished.
                        // When the delayed indexing job runs it will pick up this update.
                        //
                        // Or add another task index job if a trait changed which isn't covered by the last
                        // index job.
                        if (
                            !areUpdatedTraitsInLastIndexSearchEntityJob ||
                            isDatePossiblyLessThanWithUncertaintyWindow(
                                oldTask.lastIndexSearchEntityJob.sendTime.getTime() +
                                    oldTask.lastIndexSearchEntityJob.delaySeconds * 1000,
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

                    // Record some affinity points (if allowed) based on the task update. We disable
                    // search affinity interactions when backfilling task actions into OpenSearch.
                    if (!withoutSearchAffinityEntityInteraction) {
                        const oldIsActiveForAffinity =
                            oldTask && !isTaskIndexDocDeleted(oldTask)
                                ? getTaskIndexDocDisplayStatus(oldTask) === "OpenActive"
                                : false;
                        const newIsActiveForAffinity = !isTaskIndexDocDeleted(newTask)
                            ? getTaskIndexDocDisplayStatus(newTask) === "OpenActive"
                            : false;

                        // If the active status of the task changes then we want to add/remove affinity
                        // points. Setting a task as active will boost the task to the top of the account's
                        // affinity list. Removing the active status from the task will remove that boost
                        // and take it out of the top of the affinity list.
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
                                            addSearchAffinityEntityActiveTaskAssigneePoints(
                                                context,
                                                {
                                                    spaceId,
                                                    assigneeId,
                                                    taskId: newTask.id,
                                                },
                                            ),
                                        );
                                    }
                                }
                            } else {
                                const oldAssigneeId = oldTask?.assignee.value?.assignee.accountId;
                                const newAssigneeId = newTask?.assignee.value?.assignee.accountId;

                                if (oldAssigneeId && oldIsActiveForAffinity) {
                                    afterWriteCallbacks.push(() =>
                                        removeSearchAffinityEntityActiveTaskAssigneePoints(
                                            context,
                                            {
                                                spaceId,
                                                assigneeId: oldAssigneeId,
                                                taskId: newTask.id,
                                            },
                                        ),
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
                        // dropdown we want the collection to rank higher for the next time the user opens
                        // the collections dropdown.
                        if (actorId !== null) {
                            for (const [
                                collectionId,
                            ] of newTask.collections.raw.collections.entries()) {
                                if (!oldTask?.collections.raw.collections.has(collectionId)) {
                                    afterWriteCallbacks.push(async () => {
                                        await markSearchAffinityEntityInteractionForAccount(
                                            context,
                                            {
                                                spaceId,
                                                accountId: actorId,
                                                entityId: `TaskCollection:${collectionId}`,
                                                interaction: {type: "LowIntentUpdate"},
                                                // We don't have the collection's access policy in scope here. Skipping the cascade
                                                // is a small inaccuracy: if a user adds a task to a collection that lives in a
                                                // site, the site won't get the cascade points from _this_ interaction. The site
                                                // will still accrue points from the task's own update.
                                                siteId: null,
                                            },
                                        );
                                    });
                                }
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
                    // know the right version number if we didn't read the previous collection so our
                    // bulk update will fail if the task is being updated instead of created.
                    if (!oldCollection) {
                        jobs.push({
                            job: {
                                type: "IndexSearchEntity",
                                spaceId,
                                update: {
                                    type: "TaskCollection",
                                    collectionId: newCollection.id,
                                    // Nothing depends on this entity when it's created. Don't bother trying to reindex
                                    // dependencies.
                                    updatedTraits: {type: "None"},
                                },
                            },
                        });
                    } else {
                        const updatedTraits: Array<"Authorization" | "Name"> = [];

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

                        if (oldCollection.name.value !== newCollection.name.value) {
                            updatedTraits.push("Name");
                        }

                        // We reindex collections every time they update, instead of throttling like we do
                        // for tasks. Task may be updated frequently while you're typing in their titles.
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
                    // TODO(calebmer): What happens if we need to reindex OpenSearch from scratch? Or
                    // there's an OpenSearch durability issue and we need to reindex some actions?
                    // Since marking search affinity interactions isn't idempotent we may end up adding
                    // more points than expected. Consider adding a flag to disable affinity updates
                    // when reindexing OpenSearch from scratch.
                    if (actorId !== null && !oldCollection) {
                        afterWriteCallbacks.push(async () => {
                            await markSearchAffinityEntityInteractionForAccount(context, {
                                spaceId,
                                accountId: actorId,
                                entityId: `TaskCollection:${newCollection.id}`,
                                interaction: {type: "HighIntentUpdate"},
                                siteId: getSiteIdFromAccessPolicyIfExists(
                                    newCollection.accessPolicy.value,
                                ),
                            });
                        });
                    }

                    return new OpensearchIndexDocIfVersionCommand(
                        TaskCollectionIndex,
                        spaceId,
                        newCollection,
                    );
                }),
            );

            const commands = await runAllPromises(commandPromises);

            await indexTaskActionTransactionBeforeWriteTestCheckpoint.waitForTest(spaceId);

            await state._context.opensearch.bulk(commands, {
                retryPartialVersionConflictError: retry,
            });

            // Capture this attempt's state for activity emission after the retry loop.
            //
            // We record here, immediately after the write, rather than at the end of the
            // attempt. `bulk()` retries the whole attempt on a version conflict, so reaching
            // this line means our write won and `state`'s diffs were taken against the docs as
            // they looked before that write.
            //
            // We keep the _first_ such state. The account name check below retries an attempt
            // whose write already landed, and that retry re-reads the docs we just wrote — so
            // a later attempt diffs the new doc against itself and captures the wrong `from`
            // state (usually no change at all).
            if (firstCompletedState === null) firstCompletedState = state;

            for (const {job, delaySeconds} of jobs) {
                // The search indexing jobs read from the task OpenSearch index. So sending the job
                // after the index write will give us correct write-after-read semantics.
                state._context.jobs.send(job, {delaySeconds});
            }

            // Wait for any registered callbacks to complete (e.g. callbacks that update search
            // affinity for tasks marked as active).
            await runAllPromises(
                afterWriteCallbacks.map(afterWriteCallback => afterWriteCallback()),
            );

            // After we've indexed our data, read all our referenced accounts again but with a
            // strong read consistency. If any referenced account name changed while indexing
            // then we need to re-index our transaction.
            //
            // Account names are not logically a part of a task object in our system, but we do
            // need to inline account names into tasks in OpenSearch so we can sort by account
            // name. We inline account names at indexing time.
            //
            // When an account name updates, we run [update by query][1] to update all
            // previously written account names. However, "previously written" is the operative
            // word. Our update by query can only catch data that finished indexing before the
            // query starts. So what happens to actions that started indexing but have not
            // finished? That's where this check comes into play. When we finish indexing, we
            // check if a name update has occurred. If it has then our transaction might not
            // have been picked up by the update by query so we attempt to re-index.
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
            //               │        3. UpdateAccountName     5. UpdateAccountName
            //               │           finishes querying        finishes writing
            //        2. account name
            //           updates              Index UpdateAccountName
            // ```
            //
            // This is the edge case we want to prevent with the retry below. We read accounts
            // at 1 which are outdated by the account name update at 2. Then we finish writing
            // our new tasks at 4 (with old inlined data) AFTER the `UpdateAccountName` indexer
            // has searched the tasks to update at 3.
            //
            // The retry will redo 1 and 4 so we write correct data.
            //
            // In practice indexing `UpdateAccountName` also requires us to first wait for an
            // OpenSearch index refresh which is currently configured to be 30s long. So this
            // edge case happens if 4 is written after the refresh 3 observes. Our example is
            // simplified to not consider index refreshing.
            //
            // [1]:
            //     https://opensearch.org/docs/latest/api-reference/document-apis/update-by-query/
            {
                const newReferencedAccountById = await runAllPromises(
                    Array.from(referencedAccountIds, accountId =>
                        getAccountWithoutAvatar(context, spaceId, accountId, {
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
                            referencedAccountById.get(accountId)!.nameVersion ===
                            newReferencedAccountById.get(accountId)!.nameVersion,
                    )
                ) {
                    referencedAccountById = new Map(
                        mapIterable(referencedAccountById, ([accountId, account]) => [
                            accountId,
                            AccountModel.mergeDataWithoutSpaceAndWithoutAvatar(
                                account,
                                newReferencedAccountById.get(accountId)!,
                            ),
                        ]),
                    );
                    retry();
                }
            }

            await indexTaskActionTransactionAfterUpdateTestCheckpoint.waitForTest(spaceId);
        }
    }

    /**
     * Gets the name of an `AccountId` referenced by one of the `TaskAction`s we're
     * indexing. Referenced accounts are determined by
     * `collectReferencedAccountIdsFromTaskAction()`. If the account is not referenced
     * then we'll throw an error.
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
            workingAccountName: account.name,
            workingAccountNameVersion: account.nameVersion,
        };
    }

    /**
     * Get the `TaskIndexDoc` for the specified `TaskId` and return null if the task
     * doesn't exist.
     */
    public getTaskIndexDocIfExists(taskId: TaskId) {
        // Return the updated doc if we have one. Otherwise we need to load the doc from
        // OpenSearch.
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
     * Records one emit-ready activity payload captured while applying an action to its
     * doc in this attempt, for emission after the winning doc write.
     */
    public recordActivityUpdate(taskId: TaskId, update: TaskActivityUpdate): void {
        this._activityUpdates.push({taskId, update});
    }

    public getActivityUpdates(): ReadonlyArray<{taskId: TaskId; update: TaskActivityUpdate}> {
        return this._activityUpdates;
    }

    /**
     * Updates the `TaskIndexDoc` for the specified `TaskId`.
     *
     * Uses optimistic concurrency control. If the task does not exist then we create
     * it. If the task exists with a different version then we need to retry.
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
     * Get the `TaskCollectionIndexDoc` for the specified `TaskCollectionId` and return
     * null if the collection doesn't exist.
     */
    public getCollectionIndexDocIfExists(collectionId: TaskCollectionId) {
        // Return the updated doc if we have one. Otherwise we need to load the doc from
        // OpenSearch.
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
     * Uses optimistic concurrency control. If the collection does not exist then we
     * create it. If the collection exists with a different version then we need to
     * retry.
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

/**
 * This is deliberately best effort rather than a canonical task history. A crash
 * between the OpenSearch write and activity projection degrades discrete entries
 * to unknown-before activity instead of requiring a transactional outbox.
 */
async function emitTaskActivityFromIndexAttempt(
    context: ServerSystemActionContext,
    state: TaskActionTransactionIndexState,
    {
        spaceId,
        actor,
        actionTransactionId,
    }: {
        spaceId: SpaceId;
        actor: TaskCreator | null;
        actionTransactionId: TaskActionTransactionId;
    },
) {
    const titleWindowUpdateByTaskId = new Map<
        TaskId,
        {
            activityTime: Date;
            fromVersion: number;
            toVersion: number;
            beforeTitleText: string;
            afterTitleText: string;
        }
    >();
    const changesByTaskId = new Map<TaskId, Array<TaskActivityEntryChange>>();

    for (const {taskId, update} of state.getActivityUpdates()) {
        if (update.type === "TitleWindow") {
            // NOTE(ifitzsimmons, 2026-08-02): It would be incredibly inefficient to try to
            // update the title window with every key stroke from a transaction – we need 1
            // read and two transactional writes for each update, and realistically, that read
            // would be strongly consistent for every update after the first one. Instead we
            // merge a task's title updates into a single window update spanning the whole
            // transaction: the first update's start state with the last update's end state.
            // Keeping both endpoints instead of only the last update preserves the state the
            // window started from — what `wasReverted` and the rendered before text compare
            // against — and leaves the window's version range gap free.
            const mergedUpdate = titleWindowUpdateByTaskId.get(taskId);

            // This shouldn't happen, since we only increment the title version for winning
            // updates, and we don't record activity for losing updates. However, we'll remain
            // a little defensive here and bail early just in case.
            if (mergedUpdate && mergedUpdate.toVersion > update.version) continue;

            titleWindowUpdateByTaskId.set(taskId, {
                // NOTE(ifitzsimmons, 2026-07-30): Using the time is technically incorrect, since
                // we should be using the hybrid logical time. There are 2 reasons we don't
                //
                // 1. We serialize the task note windows into bytes, and that serialization depends
                //    on being able to represent the window start time as the difference between
                //    the time the chunk was created and the window start time. If we wanted to use
                //    hybrid logical time, there'd be no way to take advantage of that.
                // 2. Task _note_ updates are not sent with the hybrid logical time, and we want to
                //    keep the data models consistent.
                //
                // In practice, we don't really lose anything by using the time, since we're not
                // using it for anything critical.
                activityTime: new Date(update.actionTime[0]),
                fromVersion: mergedUpdate?.fromVersion ?? update.version - 1,
                toVersion: update.version,
                beforeTitleText: mergedUpdate?.beforeTitleText ?? update.beforeTitleText,
                afterTitleText: update.afterTitleText,
            });
            continue;
        }

        getOrSetDefaultMapValue(changesByTaskId, taskId, () => []).push(update);
    }

    await runAllPromises([
        (async () => {
            await emitTaskActivityBeforeProjectionTestCheckpoint.waitForTest("Discrete");
            await processTaskActivityEntriesByTaskId(
                context,
                spaceId,
                actor,
                actionTransactionId,
                changesByTaskId,
            );
        })(),
        ...Array.from(titleWindowUpdateByTaskId, async ([taskId, titleWindowUpdate]) => {
            await emitTaskActivityBeforeProjectionTestCheckpoint.waitForTest(taskId);

            await applyTaskActivityWindowUpdate(context, {
                spaceId,
                taskId,
                update: {
                    actor,
                    activityTime: titleWindowUpdate.activityTime,
                    fromVersion: titleWindowUpdate.fromVersion,
                    toVersion: titleWindowUpdate.toVersion,
                    content: {
                        type: "Title",
                        beforeTitleText: titleWindowUpdate.beforeTitleText,
                        afterTitleText: titleWindowUpdate.afterTitleText,
                    },
                },
            });
        }),
    ]);
}

async function applyTaskActionAndCaptureActivity(
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
                // If this is our initial attempt to create a task then optimistically assume it
                // doesn't exist.
                action.taskAction.type === "Create" && isInitialAttempt
                    ? null
                    : await state.getTaskIndexDocIfExists(action.taskId);

            if (!oldTask && action.taskAction.type === "Create") {
                const creator = {
                    ...state.getActionReferencedSortableAccount(
                        action.taskAction.creator.accountId,
                    ),
                    from: action.taskAction.creator?.from ?? null,
                };

                state.putTaskIndexDoc(
                    action.taskId,
                    {
                        id: action.taskId,
                        spaceId: state.spaceId,
                        ...createEmptyTaskIndexDoc(action.time, action.taskAction),
                        creator,
                        version: null,
                        titleIndexVersion: 0,
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

                // Creates carry their values on the action itself and are always activity-bearing
                // (a replayed create is deduplicated by its idempotency marker), so record
                // directly instead of diffing docs a fresh create doesn't have.
                state.recordActivityUpdate(action.taskId, {
                    type: "TaskCreated",
                    actionTime: action.time,
                });
                return;
            }

            // Retry if we can't find the task. Actions may be applied out of order but a
            // prerequisite for committing an update task action is having seen a create task
            // action. So eventually we expect the task to exist.
            //
            // Another option could be to put the action in some kind of pending queue, wait
            // for the task to be created, then apply tasks from the pending queue but that
            // would have storage costs.
            if (!oldTask) {
                throw state.retry(
                    new InternalError(
                        "Task not found in index, shouldn\u2019t be allowed to commit an update action before a create action",
                    ),
                );
            }

            let newTask = applyTaskActionToTaskIndexDoc(
                oldTask,
                action.time,
                action.taskAction,
                accountId => state.getActionReferencedSortableAccount(accountId),
            );

            // Capture what this action means for activity from the doc diff around its
            // application, for emission after the winning doc write (see
            // `getTaskActivityUpdateFromTaskIndexDocs()` for the noop policy).
            const activity = getTaskActivityUpdateFromTaskIndexDocs(action, oldTask, newTask);

            if (activity?.type === "TitleWindow") {
                // Effective title updates advance the doc-carried `titleIndexVersion`. Title noops
                // never produce a payload, so a title payload IS an effective change: the counter
                // only moves on the winning write — replays, which apply as identity noops, never
                // advance it — and the version is stamped onto the payload here where the doc is
                // in hand.
                const titleIndexVersion = oldTask.titleIndexVersion + 1;
                newTask = {...newTask, titleIndexVersion};
                state.recordActivityUpdate(action.taskId, {
                    ...activity,
                    version: titleIndexVersion,
                });
            } else if (activity !== null) {
                state.recordActivityUpdate(action.taskId, activity);
            }

            // NOTE(calebmer): Maintaining referential identity to avoid having to make an
            // update network request is an important optimization.
            //
            // In addition to avoiding a network request, this optimization can help avoid some
            // retries too under high contention workloads since it's ok if the doc in
            // OpenSearch has updated from underneath us. The result if we try to reapply would
            // be the same.
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
            // If this is our initial attempt to create a collection then optimistically assume
            // it doesn't exist.
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

            // Retry if we can't find the collection. Actions may be applied out of order but a
            // prerequisite for committing an update collection action is having seen a create
            // collection action. So eventually we expect the collection to exist.
            if (!oldCollection) {
                throw state.retry(
                    new InternalError(
                        "Task collection not found in index, shouldn\u2019t be allowed to commit an update action before a create action",
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
            // In addition to avoiding a network request, this optimization can help avoid some
            // retries too under high contention workloads since it's ok if the doc in
            // OpenSearch has updated from underneath us. The result if we try to reapply would
            // be the same.
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
        // We don't increment action count for `UpdateChildrenCounts` because it's a system
        // action automatically committed when updating a child task. Child task updates
        // should not count as contribution to the parent task.
        case "UpdateChildrenCounts":
            return null;

        // We don't increment action count for `UpdateAssigneePosition` since it updates
        // private information not observable by anyone but the assigned account.
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
        case "UpdateLayout":
        case "UpdateAccessPolicy":
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
 * Index an account name update action for a space. Uses the OpenSearch [update by
 * query API][1] to find every `TaskSortableAccount` the account name is referenced
 * in and updates to the latest value. This may take a while to run as queries and
 * bulk updates may be expensive. Then we need to retry on version conflicts as
 * well.
 *
 * As long as this takes less than, say, 5min we're good. So that indexing
 * comfortably completes before the action leaves `TaskRealtimeService`'s action
 * history window.
 *
 * [1]:
 *     https://opensearch.org/docs/latest/api-reference/document-apis/update-by-query/
 */
function indexTaskUpdateAccountNameActionAssumingItsCommitted(
    context: Context<DynamoContextModules & {opensearch: OpensearchContextModule}>,
    spaceId: SpaceId,
    action: TaskUpdateAccountNameAction,
) {
    return context.tracer.withSpan("Index account name update task action", async context => {
        // Assuming the update account name action has been committed, all future actions
        // that reference an account use the new account name. (Because we read referenced
        // accounts with strong consistency during action indexing.)
        //
        // We immediately start updating account names in tasks (the first `run()` call
        // above) but we since OpenSearch doesn't have read-after-write consistency we
        // can't guarantee we've updated absolutely all tasks until the index refreshes.
        // The [OpenSearch serverless refresh interval for search indexes][1] is
        // approximately 10 seconds. We'll wait 3x that (30 seconds) to absolutely make
        // sure we're running after the index refreshes then we call `run()` to update all
        // account names update a second time in case there are any new tasks we missed
        // before the refresh.
        //
        // We're ok with action indexing taking a while as long as it takes less than ~5min
        // so it fits in our `TaskRealtimeService` action history window (currently
        // configured to be ~10min).
        //
        // In unit tests we force a refresh immediately. Since indexes must be manually
        // refreshed in unit tests (refresh interval set to -1). It's not recommended to
        // force a refresh in production since that could harm index performance.
        //
        // NOTE(calebmer, 2025-04-10): This used to be implemented with [OpenSearch's
        // `_update_by_query`][2] but since we migrated to OpenSearch serverless we can't
        // use `_update_by_query`. So we manually implement effectively the same behavior
        // here.
        //
        // [1]:
        //     https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-overview.html
        // [2]:
        //     https://opensearch.org/docs/latest/api-reference/document-apis/update-by-query/
        if (import.meta.jest) {
            await context.opensearch.refresh(TaskIndex);

            await indexTaskUpdateAccountNameActionBeforeUpdateTestCheckpoint.waitForTest(
                action.accountId,
            );

            await run();

            await indexTaskUpdateAccountNameActionAfterUpdateTestCheckpoint.waitForTest(
                action.accountId,
            );
        } else {
            const firstRunStartTimeMs = Date.now();
            await run();
            const firstRunEndTimeMs = Date.now();

            // Make sure a refresh has happened since the start of this action. In case our
            // initial search missed some stale data.
            const waitDurationMs =
                taskIndexWaitForRefreshDelayMs - (firstRunEndTimeMs - firstRunStartTimeMs);

            if (waitDurationMs > 0) {
                await context.tracer.withSpan("Waiting for task index to refresh", async () => {
                    await wait(waitDurationMs);
                });
            }

            await run();
        }

        async function run() {
            const searchSize = 100;
            let afterCursor: ReadonlyArray<JsonScalarValue> | null = null;

            const mutexes = createArrayWithLength(5, () => new Mutex());
            const promiseWaiter = new PromiseWaiter();

            do {
                const {hits} = await context.opensearch.searchWithoutSource(TaskIndex, spaceId, {
                    size: searchSize,
                    sort: ["_doc"],
                    afterCursor: afterCursor ?? undefined,
                    query: {
                        bool: {
                            // Enter a filter context. Query clauses in a filter context may be cached.
                            // https://opensearch.org/docs/latest/query-dsl/query-filter-context/#filter-context
                            filter: {
                                bool: {
                                    must: [
                                        // Only update tasks in this space:
                                        {term: {spaceId: new OpensearchQueryValue(spaceId)}},

                                        // We want to update deleted tasks in addition to undeleted tasks. Which is why we
                                        // don't have a deleted task filter here.
                                    ],

                                    minimum_should_match: 1,
                                    should: (
                                        [
                                            "creator",
                                            "status.value.closer",
                                            "assignee.value.assignee",
                                            "assignee.value.assigner",
                                        ] as const
                                    ).map(sortableAccountField => ({
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
                });

                const newAccount = {
                    accountId: action.accountId,
                    workingAccountNameVersion: action.accountNameVersion,
                    workingAccountName: action.accountName,
                };

                for (let i = 0; i < hits.length; i++) {
                    const hit = hits[i]!;

                    // Add to a `promiseWaiter` so if the we reject `promiseWaiter.wait()` will throw.
                    // `mutex.waitForUnlock()` will not throw.
                    promiseWaiter.waitUntil(
                        mutexes[i % mutexes.length]!.withLock(async () => {
                            await retryWithExponentialBackoff(async retry => {
                                // Use the doc from `search()` on our initial attempt and if there was a version
                                // conflict with the initial doc try loading the doc again.
                                const doc = assertExists(
                                    await context.opensearch.getDocIfExists(
                                        TaskIndex,
                                        spaceId,
                                        hit.id,
                                    ),
                                );

                                const newDoc = {...doc, version: assertExists(doc.version)};
                                let hasChanged = false;

                                if (
                                    newDoc.creator.accountId === action.accountId &&
                                    newDoc.creator.workingAccountNameVersion <
                                        action.accountNameVersion
                                ) {
                                    hasChanged = true;
                                    newDoc.creator = {...newAccount, from: newDoc.creator.from};
                                }

                                if (
                                    newDoc.status.value.type === "Closed" &&
                                    newDoc.status.value.closer.accountId === action.accountId &&
                                    newDoc.status.value.closer.workingAccountNameVersion <
                                        action.accountNameVersion
                                ) {
                                    hasChanged = true;

                                    newDoc.status = new TaskStatusWithSortableAccountRegister(
                                        {...newDoc.status.value, closer: newAccount},
                                        newDoc.status.version,
                                    );
                                }

                                if (
                                    newDoc.assignee.value &&
                                    newDoc.assignee.value.assignee.accountId === action.accountId &&
                                    newDoc.assignee.value.assignee.workingAccountNameVersion <
                                        action.accountNameVersion
                                ) {
                                    hasChanged = true;

                                    newDoc.assignee = new TaskAssigneeWithSortableAccountRegister(
                                        {...newDoc.assignee.value, assignee: newAccount},
                                        newDoc.assignee.version,
                                    );
                                }

                                if (
                                    newDoc.assignee.value &&
                                    newDoc.assignee.value.assigner.accountId === action.accountId &&
                                    newDoc.assignee.value.assigner.workingAccountNameVersion <
                                        action.accountNameVersion
                                ) {
                                    hasChanged = true;

                                    newDoc.assignee = new TaskAssigneeWithSortableAccountRegister(
                                        {...newDoc.assignee.value, assigner: newAccount},
                                        newDoc.assignee.version,
                                    );
                                }

                                if (hasChanged) {
                                    await context.opensearch.indexDocIfVersion(
                                        TaskIndex,
                                        spaceId,
                                        newDoc,
                                        {retryVersionConflictError: retry},
                                    );
                                }
                            });
                        }),
                    );
                }

                await promiseWaiter.wait();

                afterCursor = (
                    hits.length > 0 ? assertExists(hits[hits.length - 1]!.cursor) : null
                ) as ReadonlyArray<JsonScalarValue> | null;

                // If we did not reach the pagination limit then don't query again for the next
                // page.
                if (hits.length < searchSize) afterCursor = null;
            } while (afterCursor !== null);
        }
    });
}

export const queryTaskIndexTestCounter = new TestCounter<SpaceId>();

/**
 * Query the OpenSearch task index.
 *
 * Remember that the task index will be behind by (hopefully) no more than 2min. So
 * to catch the query up to the actual present result you need to replay ~2min of
 * actions since the query started.
 *
 * Where do we get 2min from? `indexDuration + refreshInterval + refreshDuration`
 * should be less than 2min. What do each of these mean?
 *
 * - `indexDuration`: The time it takes from action transaction commit finish to
 *   action transaction index finish. Basically the duration of
 *   `indexTaskActionTransactionAssumingItsCommitted()`.
 *
 * - `refreshInterval`: The interval at which OpenSearch refreshes its indexes. For
 *   the task index we've configured this to be 30 seconds.
 *
 * - `refreshDuration`: The amount of time it takes to refresh the OpenSearch
 *   index.
 *
 * By default `TaskRealtimeActionHistory` (which is responsible for maintaining our
 * action history in memory) holds the last ~5min of actions. We also timeout
 * searches after 30s.
 *
 * We should eventually set SLAs for task indexing and OpenSearch to avoid weird
 * glitches when we can't fully catch up a query.
 */
export async function queryTaskIndex(
    context: Context<
        Replace<
            AuthorizeSpaceAccessContextModules,
            {opensearch: OpensearchContextModule; actor: SystemActorContextModule}
        >
    >,
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
        afterCursor: afterCursor
            ? convertTaskQuerySortCursorToOpensearchCursor(sorts, afterCursor)
            : undefined,
    });

    return tasks;
}

/**
 * If the action completes successfully then we'll schedule an `IndexSearchEntity`
 * job for the provided `TaskId` if there isn't already a job scheduled for this
 * update.
 *
 * We do no authorization that the `actor` is allowed to access a task. Since this
 * function does not reveal information about the task to the caller or update the
 * task. It only schedules a indexing job which is idempotent and should be run
 * whenever the task changes.
 */
export async function withSendTaskIndexSearchEntityJobIfNeeded<Value>(
    context: TaskRealtimeActionContext,
    {spaceId, taskId}: {spaceId: SpaceId; taskId: TaskId},
    action: () => Promise<Value>,
): Promise<Value> {
    // If this is a test where OpenSearch is disabled then don't bother trying to
    // schedule a search entity indexing job.
    if (process.env.NODE_ENV === "test" && context.opensearch.isDisabledForTest()) {
        return await action();
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

        // If we didn't find the task, we may be waiting for it to be created in the index.
        // The index is updated asynchronously after tasks are committed.
        if (!task) {
            throw retry(new InternalError("Task not found in index"));
        }

        if (task.spaceId !== spaceId) throw new FailedPreconditionError("Space mismatch");

        const currentTime = new Date();

        // Don't add a task index job until after the first one's delay has finished. When
        // the delayed indexing job runs it will pick up this update.
        if (
            isDatePossiblyLessThanWithUncertaintyWindow(
                task.lastIndexSearchEntityJob.sendTime.getTime() +
                    task.lastIndexSearchEntityJob.delaySeconds * 1000,
                currentTime,
            )
        ) {
            // NOTE(calebmer): Updating traits is currently unsupported for this function but
            // should be easy to add.
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
