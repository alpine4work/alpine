import createTree, {Tree} from "functional-red-black-tree";
import {Store} from "~/client/helpers/store/store.js";
import {ValueStore} from "~/client/helpers/store/value_store.js";
import {TaskClientStoreTaskEntry} from "~/client/tasks/task_client_store.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskClientQueryId, TaskId} from "~/shared/id/types/id_types.js";
import {evaluateTaskQueryNormalizedFiltersForModel} from "~/shared/tasks/model/evaluate_task_query_normalized_filters_for_model.js";
import {getTaskQueryNormalizedSortCursorForModel} from "~/shared/tasks/model/get_task_query_normalized_sort_cursor_for_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    compareTaskQuerySortCursors,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskRealtimeQueryLoadedState} from "~/shared/tasks/task_realtime_protocol.js";

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
 */
export class TaskClientQuery {
    private readonly _internal: TaskClientQueryInternal;

    /**
     * The query's loaded task order.
     *
     * The query might be keeping track of more tasks that aren't in the loaded
     * task range.
     */
    public readonly taskOrderStore: Store<Tree<TaskQuerySortCursor, null>>;

    constructor(internal: TaskClientQueryInternal) {
        this._internal = internal;
        this.taskOrderStore = this._internal.taskOrderStore;
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
    public getTaskEntryStore(taskId: TaskId): Store<TaskClientStoreTaskEntry> {
        return this._internal.getTaskEntryStore(taskId);
    }
}

export class TaskClientQueryInternal {
    public readonly id: TaskClientQueryId;
    public readonly filters: TaskQueryNormalizedFilters;
    public readonly sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    public readonly external: TaskClientQuery;

    private readonly _taskOrderStore: ValueStore<{
        loadedState: TaskRealtimeQueryLoadedState;
        taskOrder: Tree<TaskQuerySortCursor, null>;
    }>;
    private readonly _taskEntryStoreById = new Map<TaskId, Store<TaskClientStoreTaskEntry>>();

    /**
     * The query's loaded task order.
     *
     * The query might be keeping track of more tasks that aren't in the loaded
     * task range.
     */
    public readonly taskOrderStore: Store<Tree<TaskQuerySortCursor, null>>;

    // NOCOMMIT: Referenced tasks and collections

    constructor({
        id,
        filters,
        sorts,
    }: {
        id: TaskClientQueryId;
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
    }) {
        this.id = id;
        this.filters = filters;
        this.sorts = sorts;
        this._taskOrderStore = new ValueStore<{
            loadedState: TaskRealtimeQueryLoadedState;
            taskOrder: Tree<TaskQuerySortCursor, null>;
        }>({
            loadedState: {type: "Partial", endCursor: null},
            taskOrder: createTree<TaskQuerySortCursor, null>((cursor1, cursor2) =>
                compareTaskQuerySortCursors(sorts, cursor1, cursor2),
            ),
        });

        this.taskOrderStore = this._taskOrderStore.map(({loadedState, taskOrder}) => {
            if (loadedState.type === "Full") return taskOrder;

            if (loadedState.endCursor === null) {
                return createTree<TaskQuerySortCursor, null>((cursor1, cursor2) =>
                    compareTaskQuerySortCursors(this.sorts, cursor1, cursor2),
                );
            } else {
                let loadedTaskOrder = taskOrder;
                let iterator = loadedTaskOrder.end;

                // Remove tasks that are out of the loaded range until we find the last task in
                // the loaded range.
                while (iterator.valid) {
                    const cursor = iterator.key!;

                    if (
                        compareTaskQuerySortCursors(this.sorts, cursor, loadedState.endCursor) <= 0
                    ) {
                        break;
                    }

                    loadedTaskOrder = iterator.remove();
                    iterator = loadedTaskOrder.end;
                }

                return loadedTaskOrder;
            }
        });

        this.external = new TaskClientQuery(this);
    }

    public assertCorrectForTest() {
        assert(process.env.NODE_ENV !== "production");

        const {taskOrder} = this._taskOrderStore.getSnapshot();
        const taskOrderIds = new Set<TaskId>();

        const iterator = taskOrder.begin;
        while (iterator.valid) {
            const taskId = getTaskQuerySortCursorTaskId(iterator.key!);

            assert(
                !taskOrderIds.has(taskId),
                "A task may not appear in a query's task order more than once",
            );
            taskOrderIds.add(taskId);

            assert(
                this._taskEntryStoreById.has(taskId),
                "Query must have a reference for every task entry store in the task order",
            );

            iterator.next();
        }

        assert(
            taskOrderIds.size === this._taskEntryStoreById.size,
            "Query must not have a reference to a task entry store that's not in the task order",
        );
    }

    public getTaskEntryStore(taskId: TaskId): Store<TaskClientStoreTaskEntry> {
        return assertExists(this._taskEntryStoreById.get(taskId));
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
        const {loadedState, taskOrder: previousTaskOrder} = this._taskOrderStore.getSnapshot();
        let taskOrder = previousTaskOrder;

        for (const [taskId, {taskEntryStore, oldTaskEntry, newTaskEntry}] of taskEntryUpdateById) {
            // Ignore tasks that haven't been backfilled yet.
            if (newTaskEntry.task === null) continue;

            const isVisible = evaluateTaskQueryNormalizedFiltersForModel(
                this.filters,
                newTaskEntry.task,
            );

            // If a task was not visible in our query, check if it's visible now and add it
            // if so.
            if (!this._taskEntryStoreById.has(taskId)) {
                if (!isVisible) continue;

                const newCursor = getTaskQueryNormalizedSortCursorForModel(
                    this.sorts,
                    newTaskEntry.task,
                );

                taskOrder = taskOrder.insert(newCursor, null);

                // Capture a reference to the task entry store so it's not garbage collected.
                this._taskEntryStoreById.set(taskId, taskEntryStore);
                continue;
            }

            // If this task exists in our query that means we've seen the backfilled
            // task before.
            assert(oldTaskEntry?.task);

            // Task used to be visible in the query but not anymore.
            if (!isVisible) {
                const oldCursor = getTaskQueryNormalizedSortCursorForModel(
                    this.sorts,
                    oldTaskEntry.task,
                );

                taskOrder = taskOrder.remove(oldCursor);

                // Get rid of our task entry store reference so it can be garbage collected.
                this._taskEntryStoreById.delete(taskId);
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

            const haveSortValuesChanged =
                compareTaskQuerySortCursors(this.sorts, oldCursor, newCursor) !== 0;

            // The task is visible in the query but the change does not affect its position
            // in the query.
            if (!haveSortValuesChanged) continue;

            taskOrder = taskOrder.remove(oldCursor).insert(newCursor, null);
        }

        if (taskOrder !== previousTaskOrder) {
            this._taskOrderStore.set({loadedState, taskOrder});
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
    public onTasksLoaded(
        loadedState: TaskRealtimeQueryLoadedState,
        previouslyBackfilledTasks: Array<{
            taskEntryStore: ValueStore<TaskClientStoreTaskEntry>;
            taskEntry: TaskClientStoreTaskEntry & {task: TaskModel};
        }>,
    ): void {
        const {loadedState: previousLoadedState, taskOrder: previousTaskOrder} =
            this._taskOrderStore.getSnapshot();

        let nextLoadedState;
        let nextTaskOrder = previousTaskOrder;

        // Can only extend the loaded state, if we're already fully loaded there's no
        // more extending we can do.
        if (previousLoadedState.type === "Full") {
            nextLoadedState = previousLoadedState;
        }
        // The query is fully loaded now. Yay!
        else if (loadedState.type === "Full") {
            nextLoadedState = loadedState;
        }
        // Loaded state didn't change.
        else if (previousLoadedState.endCursor === null && loadedState.endCursor === null) {
            nextLoadedState = previousLoadedState;
        } else {
            // Is this loaded state an extension of the last one?
            const isExtending =
                previousLoadedState.endCursor === null ||
                (loadedState.endCursor !== null &&
                    compareTaskQuerySortCursors(
                        this.sorts,
                        previousLoadedState.endCursor,
                        loadedState.endCursor,
                    ) < 0);

            nextLoadedState = !isExtending ? previousLoadedState : loadedState;
        }

        for (const {taskEntryStore, taskEntry} of previouslyBackfilledTasks) {
            const isVisible = evaluateTaskQueryNormalizedFiltersForModel(
                this.filters,
                taskEntry.task,
            );
            if (!isVisible) continue;

            const newCursor = getTaskQueryNormalizedSortCursorForModel(this.sorts, taskEntry.task);

            nextTaskOrder = nextTaskOrder.insert(newCursor, null);

            // Capture a reference to the task entry store so it's not garbage collected.
            this._taskEntryStoreById.set(taskEntry.task.id, taskEntryStore);
        }

        if (previousLoadedState !== nextLoadedState || previousTaskOrder !== nextTaskOrder) {
            this._taskOrderStore.set({loadedState: nextLoadedState, taskOrder: nextTaskOrder});
        }

        // Make sure our query is well formed in test environments.
        if (process.env.NODE_ENV !== "production") {
            this.assertCorrectForTest();
        }
    }
}
