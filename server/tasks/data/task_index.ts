import {dangerouslyGetAccountIfExistsWithoutCaching} from "~/server/accounts/accounts_table.js";
import {DynamoSystemActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {SystemActorContextModule} from "~/server/helpers/actor_context_module.js";
import {TestCheckpoint} from "~/server/helpers/test/test_checkpoint.js";
import {TestCounter} from "~/server/helpers/test/test_counter.js";
import {OpensearchContextModule} from "~/server/opensearch/opensearch_context_module.js";
import {OpensearchIndex} from "~/server/opensearch/opensearch_index.js";
import {
    OpensearchIndexFlattenedKeysType,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {OpensearchQueryValue} from "~/server/opensearch/opensearch_query_clause.js";
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
import {
    TaskCollectionIndexDocType,
    TaskCollectionIndexDocWithVersion,
} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDocType, TaskIndexDocWithVersion} from "~/server/tasks/data/task_index_doc.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {collectReferencedAccountIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_account_ids_from_task_action.js";
import {TaskAction, TaskUpdateAccountNameAction} from "~/shared/tasks/actions/task_action.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";

const taskIndexRefreshIntervalSecs = 30;
const taskIndexRefreshIntervalMs = taskIndexRefreshIntervalSecs * 1000;

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
    sort: [
        {field: "spaceId"},
        {field: "isDeleted"},
        {field: "status.value.type"},
        {field: "createdTime.absoluteTime"},
    ],
    // Serving realtime task data is handled by a separate service. So we can
    // afford to slow down our task refresh interval for improved indexing
    // performance.
    refreshInterval: `${taskIndexRefreshIntervalSecs}s`,
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
 * Get multiple collections in parallel as a system actor. System actors have
 * access to all collections in the space.
 */
export async function getTaskCollectionIndexDocsIfExist(
    context: Context<{
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        opensearch: OpensearchContextModule;
        actor: SystemActorContextModule;
    }>,
    spaceId: SpaceId,
    collectionIds: ReadonlyArray<TaskCollectionId>,
) {
    // We don't verify that the account is allowed to load these documents. We
    // require a system actor with access to the entire space.
    context.actor.authorizeSystem();
    await authorizeSpaceAccess(context, spaceId);

    return context.opensearch.client.multiGetDocsIfExist(
        context.tracer.getTracer(),
        TaskCollectionIndex,
        spaceId,
        collectionIds,
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
    context: ServerSystemActionContext,
    spaceId: SpaceId,
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
    private readonly _context: ServerSystemActionContext;
    public readonly spaceId: SpaceId;
    public readonly retry: (error?: unknown) => never;
    private readonly _actionReferencedAccountById: ReadonlyMap<AccountId, AccountModel>;

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
        context: ServerSystemActionContext,
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
        context: ServerSystemActionContext,
        spaceId: SpaceId,
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
                        // Avoid our account cache to get the latest account model. Ok to get these
                        // accounts without authorization since we call `getAccount()` for these same
                        // accounts earlier which will perform authorization.
                        dangerouslyGetAccountIfExistsWithoutCaching(
                            context.dynamo.setDefaultReadConsistency("Strong"),
                            accountId,
                        ),
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
                    referencedAccountById = newReferencedAccountById;
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
    public getActionReferencedAccountName(accountId: AccountId): {
        name: string;
        nameVersion: number;
    } {
        return assertExists(this._actionReferencedAccountById.get(accountId)).initialData;
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
                const {name: workingAccountName, nameVersion: workingAccountNameVersion} =
                    state.getActionReferencedAccountName(action.taskAction.creatorId);

                state.putTaskIndexDoc(action.taskId, {
                    id: action.taskId,
                    spaceId: state.spaceId,
                    ...createEmptyTaskIndexDoc(action.time, action.taskAction),
                    creator: {
                        accountId: action.taskAction.creatorId,
                        workingAccountName,
                        workingAccountNameVersion,
                    },
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

            const newTask = applyTaskActionToTaskIndexDoc(
                oldTask,
                action.time,
                action.taskAction,
                accountId => state.getActionReferencedAccountName(accountId),
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
            cast<"Create">(action.notepadPageAction.type);
            return;
        }
        default:
            throw exhaustive(action);
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
    context: ServerSystemActionContext,
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
                await context.opensearch.client.refresh(context.tracer.getTracer(), TaskIndex);
            } else {
                await context.tracer.withSpan(
                    "Waiting for task index to refresh",
                    async context => {
                        await wait(
                            taskIndexRefreshIntervalMs +
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
                    },
                );
            }

            lastUpdateByQueryStartTime = Date.now();

            // Double check that we're updating a doc that matches our query. If not then
            // consider this script execution a noop.
            //
            // NOTE(calebmer, 2023-09-25): As I'm adding this, it's unclear to me how docs
            // that are updated but not refreshed work. Does the script get the same doc as
            // what's in the index even if the index isn't refreshed? Or does the script
            // get the live doc? This noop check only makes sense if the script gets the
            // live, out-of-date, doc.
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

            const {versionConflictCount} = await context.opensearch.client.updateByQuery(
                context.tracer.getTracer(),
                TaskIndex,
                spaceId,
                {
                    query: {
                        bool: {
                            // Enter a filter context. Query clauses in a filter context may be cached.
                            // https://opensearch.org/docs/latest/query-dsl/query-filter-context/#filter-context
                            filter: [
                                // Only update tasks in this space:
                                {term: {spaceId: new OpensearchQueryValue(spaceId)}},

                                // We want to update deleted tasks in addition to undeleted tasks. Which is why
                                // we don't have a deleted task filter here.

                                {
                                    bool: {
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
                            ],
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
