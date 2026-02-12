import createTree, {Tree} from "functional-red-black-tree";
import {
    TaskClientReadonlyStore,
    TaskClientStoreCollectionEntry,
    TaskClientStoreInternal,
    TaskClientStoreTaskEntry,
} from "~/client/web/tasks/core/task_client_store.js";
import {TaskClientTaskReferencesSubscriptionBase} from "~/client/web/tasks/core/task_client_task_references_subscription_base.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {batchStoreUpdates} from "~/shared/store/batch_store_updates.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";
import {evaluateTaskQueryNormalizedFiltersForModel} from "~/shared/tasks/model/evaluate_task_query_normalized_filters_for_model.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    compareTaskQuerySortCursors,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskRealtimeQueryLoadedState} from "~/shared/tasks/task_realtime_protocol.js";

// Keep track of the previous task object the query saw so we can check if
// we've missed any updates. We run this validation in `development` and
// `test` since maintaining task update state correctly is a little tricky to
// get right but critical to the operation of this class.
const previousTaskByIdByQueryForTest =
    process.env.NODE_ENV !== "production"
        ? new WeakMap<TaskClientQueryInternal, Map<TaskId, TaskClientStoreTaskEntry>>()
        : null;

/**
 * Maintains the state of a query on the client. Whenever a task is updated in
 * the client store we let all our client queries know and they decide whether
 * or not an update is needed.
 *
 * The loading sequence for a query goes like this:
 *
 * 1. A new query model is created in the store before we send a
 *    `subscribeToQuery` procedure from `TaskRealtimeProtocol` to the server.
 *
 * 2. The query receives and incorporates realtime events into the query model
 *    state, including the realtime event side-effect of `subscribeToQuery`
 *    that backfills all our tasks.
 *
 * 3. `subscribeToQuery` returns with the `loadedState` (our query's pagination
 *    state) and `previouslyBackfilledTaskIds` which is tasks the server
 *    previously backfilled that may not be in our query model since they
 *    weren't in the backfill event we sent for the query. Once we incorporate
 *    `previouslyBackfilledTaskIds` into our query model the model is considered
 *    fully loaded.
 *
 * This process is more or less repeated when loading more tasks with the
 * `loadMoreQueryTasks` procedure in `TaskRealtimeProtocol`.
 *
 * While the name of this class mirrors `TaskRealtimeQuery` on the server, the
 * actual direct comparable class is `TaskRealtimeQuerySubscription`. Since the
 * query holds objects referenced by tasks. You'll see a lot of similar
 * code/patterns between this class and `TaskRealtimeQuerySubscription`.
 */
export class TaskClientQuery {
    /**
     * A readonly reference to the task store.
     *
     * If you want to write you should have a full `TaskClientStore` instance.
     * This allows code to carefully control write access. For example,
     * `<TaskRowView>` has a `TaskClientReadonlyStore` and `TaskClientQuery`.
     * `<TaskRowView>` must make mutations through a `commitActionTransaction` prop
     * since it doesn't have types that allow write access.
     */
    public readonly store: TaskClientReadonlyStore;

    public readonly filters: TaskQueryNormalizedFilters;
    public readonly sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    private readonly _internal: TaskClientQueryInternal;

    /**
     * The current loaded state of the query.
     */
    public readonly loadedStateStore: Store<"Unloaded" | "PartiallyLoaded" | "FullyLoaded">;

    /**
     * The query's loaded task order.
     *
     * The query might be keeping track of more tasks that aren't in the loaded
     * task range.
     */
    public readonly taskOrderStore: Store<Tree<TaskQuerySortCursor, null>>;

    /**
     * The number of tasks we want to additionally load on top of what's already in
     * the query. Will be zero if the query is fully loaded.
     *
     * The `TaskClientQuery` class does not make requests to load more data.
     * Instead `TaskRealtimeClient` listens to this store and will make a request
     * to load more data.
     */
    public readonly loadMoreTaskCountStore: Store<number>;

    constructor(internal: TaskClientQueryInternal) {
        this._internal = internal;
        this.store = this._internal.store.external;
        this.filters = this._internal.filters;
        this.sorts = this._internal.sorts;
        this.loadedStateStore = this._internal.loadedStateStore;
        this.taskOrderStore = this._internal.taskOrderStore;
        this.loadMoreTaskCountStore = this._internal.loadMoreTaskCountStore;
    }

    /**
     * You're allowed to get the query's internal instance if you have an internal
     * store instance. Otherwise you must use the query's public methods.
     */
    public _getInternal(internal: TaskClientStoreInternal) {
        assert(internal instanceof TaskClientStoreInternal);
        return this._internal;
    }

    public getReferencedTaskIdsForTest() {
        return this._internal.getReferencedTaskIdsForTest();
    }

    public getReferencedCollectionIdsForTest() {
        return this._internal.getReferencedCollectionIdsForTest();
    }

    public retain() {
        this._internal.retain();
    }

    public release() {
        this._internal.release();
    }

    /**
     * If there was an error in our `TaskRealtimeService` subscription for this
     * query then this function is called to transition the query to an error
     * state. The error will be re-thrown in UI components when trying to access
     * the query's data.
     */
    public setError(error: unknown) {
        this._internal.setError(error);
    }

    /**
     * If this query is in an erred state because `setError()` was previously
     * called then this function clears the error and allows normal operation to
     * resume.
     */
    public clearError() {
        this._internal.clearError();
    }

    /**
     * Get the store associated with the provided `TaskId` if it's loaded in the
     * query. If it's not loaded in the query you'll get null.
     */
    public getLoadedTaskEntryStoreIfExists(taskId: TaskId): Store<TaskClientStoreTaskEntry> | null {
        return this._internal.getLoadedTaskEntryStoreIfExists(taskId);
    }

    /**
     * Get the store associated with the provided `TaskId`.
     *
     * Throws an error if `TaskId` is not a part of the query when you call this
     * function.
     *
     * The `task` in this store should be non-null when this function is called but
     * if you hold onto this reference for long enough you may see `task` become
     * null because the task leaves this query and becomes unauthorized.
     */
    public getLoadedTaskEntryStore(taskId: TaskId): Store<TaskClientStoreTaskEntry> {
        return this._internal.getLoadedTaskEntryStore(taskId);
    }

    /**
     * Get a snapshot of the task associated with the provided `TaskId`. Prefer
     * using `getLoadedTaskEntryStore()` since it will give you changes to the task
     * over time.
     *
     * Throws an error if `TaskId` is not a part of the query when you call this
     * function.
     */
    public getLoadedTaskSnapshot(taskId: TaskId): TaskModel {
        return assertExists(this._internal.getLoadedTaskEntryStore(taskId).getSnapshot().task);
    }

    /**
     * Get the store associated with the provided `TaskId`.
     *
     * Throws an error if `TaskId` is not referenced by some task in the query when
     * you call this function.
     *
     * The `task` in this store should be non-null when this function is called but
     * if you hold onto this reference for long enough you may see `task` become
     * null because the task becomes unauthorized.
     */
    public getReferencedTaskEntryStore(taskId: TaskId): Store<TaskClientStoreTaskEntry> {
        return this._internal.getReferencedTaskEntryStore(taskId);
    }

    /**
     * Get a snapshot of the task associated with the provided `TaskId`. Prefer
     * using `getReferencedTaskEntryStore()` since it will give you changes to the
     * task over time.
     *
     * Throws an error if `TaskId` is not referenced by some task in the query when
     * you call this function.
     */
    public getReferencedTaskSnapshot(taskId: TaskId): TaskModel {
        return this._internal.getReferencedTaskSnapshot(taskId);
    }

    /**
     * Get the collection associated with the provided `TaskCollectionId`.
     *
     * Throws an error if `TaskCollectionId` is not referenced by this class
     * when you call this function.
     *
     * The `collection` in this store should be non-null when this function is
     * called but if you hold onto this reference for long enough you may see
     * `collection` become null because the task becomes unauthorized.
     */
    public getReferencedCollectionEntryStore(
        collectionId: TaskCollectionId,
    ): Store<TaskClientStoreCollectionEntry> {
        return this._internal.getReferencedCollectionEntryStore(collectionId);
    }

    /**
     * Get a snapshot of the task associated with the provided `TaskCollectionId`.
     * Prefer using `getReferencedCollectionEntryStore()` since it will give you
     * changes to the task over time.
     *
     * Throws an error if `TaskCollectionId` is not referenced by this class when
     * you call this function.
     */
    public getReferencedCollectionSnapshot(collectionId: TaskCollectionId): TaskCollectionModel {
        return this._internal.getReferencedCollectionSnapshot(collectionId);
    }

    /**
     * Load more tasks into the query.
     *
     * Will do nothing if the query is already fully loaded.
     *
     * If we're waiting on some data to load and you call this function again with
     * the same `limit` then your request is covered by the previous load and we
     * won't load additional data. If your limit is higher than what we're already
     * loading (say by 10) then once the current requests finishes we'll ask for 10
     * more tasks.
     *
     * Can only load more data if we're connected to the task realtime service.
     */
    public loadMoreTasks(limit: number): void {
        this._internal.loadMoreTasks(limit);
    }

    /**
     * Get the index of the `cursor` for a loaded task in our query. Will throw an
     * error if the cursor is not a valid cursor for a task currently loaded in
     * our query.
     */
    public getLoadedTaskIndex(cursor: TaskQuerySortCursor): number {
        return this._internal.getLoadedTaskIndex(cursor);
    }

    /**
     * Return a promise that resolves when the query has some tasks loaded. Queries
     * start in an unloaded state with no data. This allows you to wait until the
     * query has some data you can display to the user.
     *
     * This promise never rejects.
     */
    public waitForLoaded(): Promise<void> {
        return new Promise(resolve => {
            {
                let loadedState;
                try {
                    loadedState = this.loadedStateStore.getSnapshot();
                } catch {
                    // If our query is in an error state then `getSnapshot()` will throw (maybe the
                    // user lost access to the query we're trying to subscribe to). That's enough
                    // progress for us to resolve this promise. We don't want to throw an uncaught
                    // error here.
                }

                if (loadedState !== "Unloaded") {
                    resolve();
                    return;
                }
            }

            const unsubscribe = this.loadedStateStore.subscribe(() => {
                let loadedState;
                try {
                    loadedState = this.loadedStateStore.getSnapshot();
                } catch {
                    // If our query is in an error state then `getSnapshot()` will throw (maybe the
                    // user lost access to the query we're trying to subscribe to). That's enough
                    // progress for us to resolve this promise. We don't want to throw an uncaught
                    // error here.
                }

                if (loadedState !== "Unloaded") {
                    unsubscribe();
                    resolve();
                }
            });
        });
    }

    /**
     * Return a promise that resolves when the query has finished the last
     * `loadMoreTasks()` request.
     */
    public waitForLoadMoreTasks(): Promise<void> {
        return new Promise((resolve, reject) => {
            {
                try {
                    const loadedState = this.loadedStateStore.getSnapshot();
                    const loadMoreTaskCount = this.loadMoreTaskCountStore.getSnapshot();

                    if (loadedState === "FullyLoaded" || loadMoreTaskCount === 0) {
                        resolve();
                        return;
                    }
                } catch (error) {
                    reject(error);
                    return;
                }
            }

            const manyStore = Store.many([this.loadedStateStore, this.loadMoreTaskCountStore]);

            const unsubscribe = manyStore.subscribe(() => {
                try {
                    const [loadedState, loadMoreTaskCount] = manyStore.getSnapshot();

                    if (loadedState === "FullyLoaded" || loadMoreTaskCount === 0) {
                        unsubscribe();
                        resolve();
                    }
                } catch (error) {
                    unsubscribe();
                    reject(error);
                }
            });
        });
    }
}

export class TaskClientQueryInternal extends TaskClientTaskReferencesSubscriptionBase {
    public readonly store: TaskClientStoreInternal;
    public readonly filters: TaskQueryNormalizedFilters;
    public readonly sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    public readonly external: TaskClientQuery;

    /**
     * Queries start with 1 reference. The reference count can be increased by
     * calling `retain()` and decreased by calling `release()` once the
     * reference count reaches 0 the query is unloaded.
     */
    private _referenceCount = 1;

    private readonly _taskOrderAndLoadedStateStore: ValueStore<{
        // `loadedState` is null when the query has not finished loading for the
        // first time.
        readonly loadedState: TaskRealtimeQueryLoadedState | null;
        readonly taskOrder: Tree<TaskQuerySortCursor, null>;
    }>;
    private readonly _loadedTaskEntryStoreById = new Map<TaskId, Store<TaskClientStoreTaskEntry>>();

    private readonly _errorStateStore = new ValueStore<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    /**
     * The current loaded state of the query.
     */
    public readonly loadedStateStore: Store<"Unloaded" | "PartiallyLoaded" | "FullyLoaded">;

    /**
     * The query's loaded task order.
     *
     * The query might be keeping track of more tasks that aren't in the loaded
     * task range.
     */
    public readonly taskOrderStore: Store<Tree<TaskQuerySortCursor, null>>;

    /**
     * The number of tasks we want to additionally load on top of what's already in
     * the query. Will be zero if the query is fully loaded.
     *
     * The `TaskClientQuery` class does not make requests to load more data.
     * Instead `TaskRealtimeClient` listens to this store and will make a request
     * to load more data.
     */
    public readonly loadMoreTaskCountStore: ValueStore<number>;

    constructor({
        store,
        filters,
        sorts,
        limit,
    }: {
        store: TaskClientStoreInternal;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        limit: number;
    }) {
        super();
        this.store = store;
        this.filters = filters;
        this.sorts = sorts;
        this.loadMoreTaskCountStore = new ValueStore(limit);

        this._taskOrderAndLoadedStateStore = new ValueStore<{
            // `loadedState` is null when the query has not finished loading for the
            // first time.
            readonly loadedState: TaskRealtimeQueryLoadedState | null;
            readonly taskOrder: Tree<TaskQuerySortCursor, null>;
        }>({
            loadedState: null,
            taskOrder: createTree<TaskQuerySortCursor, null>((cursor1, cursor2) =>
                compareTaskQuerySortCursors(this.sorts, cursor1, cursor2),
            ),
        });

        this.loadedStateStore = Store.map(
            this._taskOrderAndLoadedStateStore,
            this._errorStateStore,
            ({loadedState}, errorState) => {
                if (errorState.hasError) throw errorState.error;

                if (loadedState === null) return "Unloaded";
                if (loadedState.type === "Full") return "FullyLoaded";
                return "PartiallyLoaded";
            },
        );

        this.taskOrderStore = Store.map(
            this._taskOrderAndLoadedStateStore,
            this._errorStateStore,
            ({loadedState, taskOrder}, errorState) => {
                if (errorState.hasError) throw errorState.error;

                if (loadedState?.type === "Full") return taskOrder;

                if (loadedState === null || loadedState.endCursor === null) {
                    return taskOrder.length === 0 ? taskOrder : createTree(taskOrder._compare);
                } else {
                    let loadedTaskOrder = taskOrder;
                    let iterator = loadedTaskOrder.end;

                    // Remove tasks that are out of the loaded range until we find the last task in
                    // the loaded range.
                    while (iterator.valid) {
                        const cursor = iterator.key!;

                        if (
                            compareTaskQuerySortCursors(
                                this.sorts,
                                cursor,
                                loadedState.endCursor,
                            ) <= 0
                        ) {
                            break;
                        }

                        loadedTaskOrder = iterator.remove();
                        iterator = loadedTaskOrder.end;
                    }

                    return loadedTaskOrder;
                }
            },
        );

        this.external = new TaskClientQuery(this);
    }

    protected override _getStore() {
        return this.store;
    }

    public assertCorrectForTest() {
        assert(process.env.NODE_ENV !== "production");

        const {taskOrder} = this._taskOrderAndLoadedStateStore.getSnapshot();
        const taskOrderIds = new Set<TaskId>();

        const iterator = taskOrder.begin;
        while (iterator.valid) {
            const taskId = getTaskQuerySortCursorTaskId(iterator.key!);

            assert(
                !taskOrderIds.has(taskId),
                "A task may not appear in a query\u2019s task order more than once",
            );
            taskOrderIds.add(taskId);

            assert(
                this._loadedTaskEntryStoreById.has(taskId),
                "Query must have a reference for every task entry store in the task order",
            );

            iterator.next();
        }

        assert(
            taskOrderIds.size === this._loadedTaskEntryStoreById.size,
            "Query must have the same tasks in `taskOrder` and `loadedTaskEntryStoreById`",
        );

        assert(
            taskOrderIds.size > 0 ||
                (this._referencedTaskEntryStoreById.size === 0 &&
                    this._referencedCollectionEntryStoreById.size === 0),
            "If client query has no loaded tasks then it shouldn\u2019t have referenced tasks or referenced collections either",
        );

        for (const taskEntryStore of this._loadedTaskEntryStoreById.values()) {
            const {task} = taskEntryStore.getSnapshot();
            if (!task) continue;

            const parentTaskId = task.getParent()?.taskId;
            if (parentTaskId) {
                assert(
                    this._referencedTaskEntryStoreById.has(parentTaskId),
                    "Client query should keep track of loaded tasks\u2019 parent tasks",
                );
            }

            for (const {collectionId} of task.getCollections().getArray()) {
                assert(
                    this._referencedCollectionEntryStoreById.has(collectionId),
                    "Client query should keep track of loaded tasks\u2019 collections",
                );
            }
        }
    }

    public getReferencedTaskIdsForTest() {
        assert(import.meta.jest);
        return new Set(this._referencedTaskEntryStoreById.keys());
    }

    public getReferencedCollectionIdsForTest() {
        assert(import.meta.jest);
        return new Set(this._referencedCollectionEntryStoreById.keys());
    }

    /**
     * Add a reference for our query. You should call `release()` later when you no
     * longer need the reference. Once the query hits zero references we will clean
     * up this query and all its data.
     */
    public retain() {
        assert(this._referenceCount > 0, "Can\u2019t retain a released query");

        this._referenceCount++;
    }

    /**
     * Release our reference to the query. Once the query hits zero references we
     * will clean up this query and all its data.
     */
    public release() {
        assert(this._referenceCount > 0, "Query is already released");

        this._referenceCount--;

        if (this._referenceCount === 0) {
            batchStoreUpdates(() => {
                // We shouldn't be loading any new tasks after this. There may still be an
                // outgoing load task request though.
                this.loadMoreTaskCountStore.set(0);

                // Delete the query from our store.
                this.store.onQueryFinallyReleased(this);
            });
        }
    }

    /**
     * Once we've finally unsubscribed from the query we can clear out all the data
     * within the query.
     */
    public onUnsubscribed() {
        assert(this._referenceCount === 0);

        batchStoreUpdates(() => {
            // Release our references to loaded tasks.
            for (const [taskId, taskEntryStore] of this._loadedTaskEntryStoreById) {
                this._onLoadedTaskRemove(taskId, taskEntryStore.getSnapshot());
            }

            // Should have been cleared by removing all our loaded tasks.
            assert(this._referencedTaskEntryStoreById.size === 0);
            assert(this._referencedCollectionEntryStoreById.size === 0);

            // Clear our query's task data.
            this._loadedTaskEntryStoreById.clear();
            this._taskOrderAndLoadedStateStore.set({
                loadedState: null,
                taskOrder: createTree<TaskQuerySortCursor, null>((cursor1, cursor2) =>
                    compareTaskQuerySortCursors(this.sorts, cursor1, cursor2),
                ),
            });
        });
    }

    public setError(error: unknown) {
        this._errorStateStore.set({hasError: true, error});
    }

    public clearError() {
        this._errorStateStore.set(errorState =>
            errorState.hasError ? {hasError: false} : errorState,
        );
    }

    public getLoadedTaskEntryStoreIfExists(taskId: TaskId): Store<TaskClientStoreTaskEntry> | null {
        return this._loadedTaskEntryStoreById.get(taskId) ?? null;
    }

    public getLoadedTaskEntryStore(taskId: TaskId): Store<TaskClientStoreTaskEntry> {
        const taskEntryStore = this._loadedTaskEntryStoreById.get(taskId);
        if (!taskEntryStore) throw new InternalError("Task is not visible in query");
        return taskEntryStore;
    }

    /**
     * Get the index of the `cursor` for a loaded task in our query. Will throw an
     * error if the cursor is not a valid cursor for a task currently loaded in
     * our query.
     */
    public getLoadedTaskIndex(cursor: TaskQuerySortCursor): number {
        const iterator = this._taskOrderAndLoadedStateStore.getSnapshot().taskOrder.find(cursor);
        assert(iterator.valid);
        return iterator.index;
    }

    public loadMoreTasks(limit: number) {
        // Noop if this query is released.
        if (this._referenceCount === 0) return;

        // If the query is fully loaded we can't load more tasks.
        if (this._taskOrderAndLoadedStateStore.getSnapshot().loadedState?.type === "Full") return;

        if (limit <= 0) return;

        this.loadMoreTaskCountStore.set(loadMoreTaskCount =>
            // Take the max since if we're already loading more tasks this call will be
            // covered by the ongoing load.
            Math.max(loadMoreTaskCount, limit),
        );
    }

    /**
     * Called by `TaskClientStore` after applying a realtime update event. This
     * function updates our task client query's internal state.
     */
    public onTasksUpdated(
        taskEntryUpdateById: Map<
            TaskId,
            {
                taskEntryStore: ValueStore<TaskClientStoreTaskEntry>;
                oldTaskEntry: TaskClientStoreTaskEntry | null;
                newTaskEntry: TaskClientStoreTaskEntry;
            }
        >,
    ) {
        // Noop if this query is released.
        if (this._referenceCount === 0) return;

        const {loadedState, taskOrder: previousTaskOrder} =
            this._taskOrderAndLoadedStateStore.getSnapshot();
        let taskOrder = previousTaskOrder;

        // Get the referenced `TaskId`s we need to update.
        const updatedOriginalReferencedTaskIds = new Set<TaskId>();
        for (const taskId of taskEntryUpdateById.keys()) {
            if (this._referencedTaskEntryStoreById.has(taskId)) {
                updatedOriginalReferencedTaskIds.add(taskId);
            }
        }

        const alreadyUpdatedReferencedTaskIds = new Set<TaskId>();

        const onBeforeReferencedTaskAddOrRemove = (taskId: TaskId) => {
            if (!updatedOriginalReferencedTaskIds.has(taskId)) return;

            if (alreadyUpdatedReferencedTaskIds.has(taskId)) return;
            alreadyUpdatedReferencedTaskIds.add(taskId);

            const taskEntryUpdate = taskEntryUpdateById.get(taskId);
            if (!taskEntryUpdate) return;

            // If we started this function call with a reference to this task then a task
            // entry must have already existed in our store.
            assert(taskEntryUpdate.oldTaskEntry);

            this._onReferencedTaskUpdate(
                taskId,
                taskEntryUpdate.oldTaskEntry,
                taskEntryUpdate.newTaskEntry,
            );
        };

        assert(this._onBeforeReferencedTaskAddOrRemove === null);
        this._onBeforeReferencedTaskAddOrRemove = onBeforeReferencedTaskAddOrRemove;
        try {
            for (const taskId of updatedOriginalReferencedTaskIds) {
                // Double check that the task wasn't removed while updating another task.
                if (!this._referencedTaskEntryStoreById.has(taskId)) continue;

                if (alreadyUpdatedReferencedTaskIds.has(taskId)) continue;
                alreadyUpdatedReferencedTaskIds.add(taskId);

                const taskEntryUpdate = taskEntryUpdateById.get(taskId);
                if (!taskEntryUpdate) continue;

                // If we started this function call with a reference to this task then a task
                // entry must have already existed in our store.
                assert(taskEntryUpdate.oldTaskEntry);

                this._onReferencedTaskUpdate(
                    taskId,
                    taskEntryUpdate.oldTaskEntry,
                    taskEntryUpdate.newTaskEntry,
                );
            }

            for (const [
                taskId,
                {taskEntryStore, oldTaskEntry, newTaskEntry},
            ] of taskEntryUpdateById) {
                if (newTaskEntry.task === null) {
                    // Ignore tasks that haven't been backfilled yet.
                    if (oldTaskEntry === null || oldTaskEntry.task === null) continue;

                    // If a task is being reverted we need to remove it from our query. But we
                    // don't have to remove tasks that don't exist in our query.
                    if (!this._loadedTaskEntryStoreById.has(taskId)) continue;

                    const oldCursor = getTaskQueryNormalizedSortCursorForModel(
                        this.sorts,
                        oldTaskEntry.task,
                    );

                    this._onLoadedTaskRemove(taskId, oldTaskEntry);

                    taskOrder = taskOrder.remove(oldCursor);
                    this._loadedTaskEntryStoreById.delete(taskId);
                    continue;
                }

                const isVisible = evaluateTaskQueryNormalizedFiltersForModel(
                    this.filters,
                    newTaskEntry.task,
                );

                // If a task was not visible in our query, check if it's visible now and add it
                // if so.
                if (!this._loadedTaskEntryStoreById.has(taskId)) {
                    if (!isVisible) continue;

                    const newCursor = getTaskQueryNormalizedSortCursorForModel(
                        this.sorts,
                        newTaskEntry.task,
                    );

                    // Only add tasks to our query that pass our filters and fit in our loaded
                    // range. This mirrors our behavior on the server.
                    // `TaskRealtimeQuerySubscription` only holds references to tasks in its loaded
                    // range. If we hold a reference to more tasks then we'll have state drift
                    // between the server and client. The server will think we do NOT have a task
                    // loaded, won't send update actions, when in fact the client has kept it
                    // retained.
                    if (
                        loadedState !== null &&
                        (loadedState.type === "Full" ||
                            (loadedState.endCursor !== null &&
                                compareTaskQuerySortCursors(
                                    this.sorts,
                                    newCursor,
                                    loadedState.endCursor,
                                ) <= 0))
                    ) {
                        this._onLoadedTaskAdd(taskId, newTaskEntry);

                        taskOrder = taskOrder.insert(newCursor, null);
                        this._loadedTaskEntryStoreById.set(taskId, taskEntryStore);
                    }
                    continue;
                }

                // If this task exists in our query that means we've seen the backfilled
                // task before.
                assert(oldTaskEntry?.task);

                // If the task didn't change we don't need to update anything.
                if (oldTaskEntry === newTaskEntry) continue;

                // Task used to be visible in the query but not anymore.
                if (!isVisible) {
                    const oldCursor = getTaskQueryNormalizedSortCursorForModel(
                        this.sorts,
                        oldTaskEntry.task,
                    );

                    this._onLoadedTaskRemove(taskId, oldTaskEntry);

                    taskOrder = taskOrder.remove(oldCursor);
                    this._loadedTaskEntryStoreById.delete(taskId);
                    continue;
                }

                const newCursor = getTaskQueryNormalizedSortCursorForModel(
                    this.sorts,
                    newTaskEntry.task,
                );
                const oldCursor = getTaskQueryNormalizedSortCursorForModel(
                    this.sorts,
                    oldTaskEntry.task,
                );

                if (
                    loadedState?.type === "Full" ||
                    (loadedState?.endCursor &&
                        compareTaskQuerySortCursors(this.sorts, newCursor, loadedState.endCursor) <=
                            0)
                ) {
                    this._onLoadedTaskUpdate(taskId, oldTaskEntry, newTaskEntry);

                    const haveSortValuesChanged =
                        compareTaskQuerySortCursors(this.sorts, oldCursor, newCursor) !== 0;

                    // The task is visible in the query but the change does not affect its position
                    // in the query.
                    if (!haveSortValuesChanged) continue;

                    taskOrder = taskOrder.remove(oldCursor).insert(newCursor, null);
                }
                // If the task moved outside of our loaded range then we need to remove it from
                // the query. The server no longer considers it subscribed anymore.
                else {
                    this._onLoadedTaskRemove(taskId, oldTaskEntry);

                    taskOrder = taskOrder.remove(oldCursor);
                    this._loadedTaskEntryStoreById.delete(taskId);
                }
            }
        } finally {
            this._onBeforeReferencedTaskAddOrRemove = null;
        }

        if (taskOrder !== previousTaskOrder) {
            this._taskOrderAndLoadedStateStore.set({
                loadedState,
                taskOrder,
            });
        }

        // Make sure our query is well formed in test environments.
        if (process.env.NODE_ENV !== "production") {
            this.assertCorrectForTest();
        }
    }

    /**
     * Called by `TaskClientStore` after the server tells us that all the tasks for
     * a query have loaded. The server also tells us which tasks it didn't include
     * in the backfill update event which we should have and should backfill into
     * our query.
     */
    public onTasksLoaded({
        limit,
        loadedState,
        previouslyBackfilledTasks,
    }: {
        limit: number;
        loadedState: TaskRealtimeQueryLoadedState;
        previouslyBackfilledTasks: Array<{
            taskEntryStore: ValueStore<TaskClientStoreTaskEntry>;
            taskEntry: TaskClientStoreTaskEntry & {task: TaskModel};
        }>;
    }): void {
        // Noop if this query is released.
        if (this._referenceCount === 0) return;

        const {loadedState: previousLoadedState, taskOrder: previousTaskOrder} =
            this._taskOrderAndLoadedStateStore.getSnapshot();

        // Optimization: Maintain our `loadedState` reference if it didn't change.
        const nextLoadedState = isDeepEqual(loadedState, previousLoadedState)
            ? previousLoadedState
            : loadedState;

        let nextTaskOrder = previousTaskOrder;

        for (const {taskEntryStore, taskEntry} of previouslyBackfilledTasks) {
            // If the task is already in our store (perhaps an update event added it) then
            // we don't need to insert the task again.
            if (this._loadedTaskEntryStoreById.has(taskEntry.task.id)) continue;

            const isVisible = evaluateTaskQueryNormalizedFiltersForModel(
                this.filters,
                taskEntry.task,
            );
            if (!isVisible) continue;

            const newCursor = getTaskQueryNormalizedSortCursorForModel(this.sorts, taskEntry.task);

            this._onLoadedTaskAdd(taskEntry.task.id, taskEntry);

            nextTaskOrder = nextTaskOrder.insert(newCursor, null);

            // Capture a reference to the task entry store so it's not garbage collected.
            this._loadedTaskEntryStoreById.set(taskEntry.task.id, taskEntryStore);
        }

        batchStoreUpdates(() => {
            // If we're fully loaded then there are no more tasks to load.
            this.loadMoreTaskCountStore.set(loadMoreTaskCount =>
                nextLoadedState?.type === "Full" ? 0 : Math.max(0, loadMoreTaskCount - limit),
            );

            if (previousLoadedState !== nextLoadedState || previousTaskOrder !== nextTaskOrder) {
                this._taskOrderAndLoadedStateStore.set({
                    loadedState: nextLoadedState,
                    taskOrder: nextTaskOrder,
                });
            }
        });

        // Make sure our query is well formed in test environments.
        if (process.env.NODE_ENV !== "production") {
            this.assertCorrectForTest();
        }
    }

    private _onLoadedTaskAdd(taskId: TaskId, newTaskEntry: TaskClientStoreTaskEntry) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskById = getOrSetDefaultMapValue(
                assertExists(previousTaskByIdByQueryForTest),
                this,
                () => new Map(),
            );

            assert(
                !previousTaskById.has(taskId),
                "Query can\u2019t add task that\u2019s already referenced with `_onLoadedTaskAdd()`",
            );

            previousTaskById.set(taskId, newTaskEntry);
        }

        // Hold a reference to all loaded tasks.
        this.store.retainTaskEntryStore(taskId);

        this._trackTaskDependenciesFromAdd(newTaskEntry);
    }

    private _onLoadedTaskUpdate(
        taskId: TaskId,
        oldTaskEntry: TaskClientStoreTaskEntry,
        newTaskEntry: TaskClientStoreTaskEntry,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskById = getOrSetDefaultMapValue(
                assertExists(previousTaskByIdByQueryForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskById.get(taskId) === oldTaskEntry,
                "Query must observe all updates to a referenced task through `_onLoadedTaskUpdate()`",
            );

            previousTaskById.set(taskId, newTaskEntry);
        }

        this._trackTaskDependenciesFromUpdate(oldTaskEntry, newTaskEntry);
    }

    private _onLoadedTaskRemove(taskId: TaskId, oldTaskEntry: TaskClientStoreTaskEntry) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskById = getOrSetDefaultMapValue(
                assertExists(previousTaskByIdByQueryForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskById.get(taskId) === oldTaskEntry,
                "Query can\u2019t remove task that is not referenced with `_onLoadedTaskRemove()`",
            );

            previousTaskById.delete(taskId);
        }

        this.store.onQueryLoadedTaskRemove?.(this, taskId);

        // Release our loaded task reference.
        this.store.releaseTaskEntryStore(taskId);

        this._trackTaskDependenciesFromRemove(oldTaskEntry);
    }
}
