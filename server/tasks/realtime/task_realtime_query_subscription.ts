import {getTaskQueryNormalizedSortCursorFromIndexDoc} from "~/server/tasks/data/get_task_query_normalized_sort_cursor_from_index_doc.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    TaskRealtimeActionTransactionActionsSlice,
    TaskRealtimeActionTransactionBackfillTaskSlice,
    TaskRealtimeActionTransactionSliceBase,
} from "~/server/tasks/realtime/task_realtime_action_transaction.js";
import {TaskRealtimeQuery} from "~/server/tasks/realtime/task_realtime_query.js";
import {
    TaskRealtimeQueryStoreCollectionEntry,
    TaskRealtimeQueryStoreInternal,
    TaskRealtimeQueryStoreTaskEntry,
} from "~/server/tasks/realtime/task_realtime_query_store.js";
import {TaskRealtimeSystemActionContext} from "~/server/tasks/realtime/task_realtime_system_action_context.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskQuerySortCursor,
    compareTaskQuerySortCursors,
} from "~/shared/tasks/task_query_sort_cursor.js";

// Keep track of the previous task object the subscription saw so we can check
// if we've missed any updates. We run this validation in `development` and
// `test` since maintaining task update state correctly is a little tricky to
// get right but critical to the operation of this class.
const previousVisibleTaskIdBySubscriptionForTest =
    process.env.NODE_ENV !== "production"
        ? new WeakMap<TaskRealtimeQuerySubscription, Map<TaskId, TaskIndexDoc>>()
        : null;

const previousLoadedTaskIdBySubscriptionForTest =
    process.env.NODE_ENV !== "production"
        ? new WeakMap<TaskRealtimeQuerySubscription, Map<TaskId, TaskIndexDoc>>()
        : null;

export class TaskRealtimeQuerySubscription {
    private readonly _query: TaskRealtimeQuery;
    private readonly _onAction: (actions: TaskRealtimeActionTransactionSliceBase) => void;
    private _loadedBeforeCursor: TaskQuerySortCursor | "FullyLoaded" | "Unloaded" = "Unloaded";
    private _loadedCount = 0;

    private readonly _otherReferencedTaskEntryById = new Map<
        TaskId,
        {
            referenceCount: number;
            taskEntry: Promise<TaskRealtimeQueryStoreTaskEntry>;
        }
    >();

    private readonly _otherReferencedCollectionEntryById = new Map<
        TaskCollectionId,
        {
            referenceCount: number;
            collectionEntry: Promise<TaskRealtimeQueryStoreCollectionEntry>;
        }
    >();

    constructor(
        store: TaskRealtimeQueryStoreInternal,
        {
            filters,
            sorts,
            onAction,
        }: {
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            onAction: (actions: TaskRealtimeActionTransactionSliceBase) => void;
        },
    ) {
        // If a query with the same filters/sorts exists then we want to reuse it.
        this._query = store.getQuery({filters, sorts});
        this._onAction = onAction;

        this._query.addSubscription(this);
    }

    public unsubscribe() {
        this._query.removeSubscription(this);
    }

    /**
     * Load more tasks into our subscription.
     *
     * Our subscription maintains a different loaded task count than the underlying
     * query. If another subscription has already fully loaded the query then this
     * call will not make a network request and instead only update our
     * subscription's state.
     */
    public async loadMoreTasks(
        context: TaskRealtimeSystemActionContext,
        limit: number,
    ): Promise<{
        hasMoreTasks: boolean;
        tasks: Array<TaskIndexDoc>;
        otherReferencedTasks: Array<TaskIndexDoc>;
        otherReferencedCollections: Array<TaskCollectionIndexDoc>;
    }> {
        await this._query.loadMoreTasks(
            context,
            this._loadedCount + limit - this._query.getLoadedTaskCount(),
        );

        const {hasMoreTasks, tasks} = this._loadMoreTasksSync(context, limit);

        const otherReferencedTaskPromiseById = new Map<TaskId, Promise<TaskIndexDoc>>();
        const otherReferencedCollectionPromiseById = new Map<
            TaskCollectionId,
            Promise<TaskCollectionIndexDoc>
        >();

        for (const task of tasks) {
            const parentTaskId = task.parent.taskId.value;
            if (parentTaskId) {
                void getOrSetDefaultMapValue(otherReferencedTaskPromiseById, parentTaskId, () =>
                    assertExists(
                        this._otherReferencedTaskEntryById.get(parentTaskId),
                    ).taskEntry.then(taskEntry => taskEntry.task),
                );
            }

            for (const {collectionId} of task.collections.raw.collections.getArray()) {
                void getOrSetDefaultMapValue(
                    otherReferencedCollectionPromiseById,
                    collectionId,
                    () =>
                        assertExists(
                            this._otherReferencedCollectionEntryById.get(collectionId),
                        ).collectionEntry.then(collectionEntry => collectionEntry.collection),
                );
            }
        }

        const [otherReferencedTasks, otherReferencedCollections] = await runAllPromises([
            runAllPromises(otherReferencedTaskPromiseById.values()),
            runAllPromises(otherReferencedCollectionPromiseById.values()),
        ]);

        return {
            hasMoreTasks,
            tasks,
            otherReferencedTasks,
            otherReferencedCollections,
        };
    }

    // Synchronous part of `loadMoreTasks()`. Advances our subscription's internal
    // state synchronously. We enforce this part is synchronous so we know that no
    // concurrent actions will happen while we're updating our state.
    private _loadMoreTasksSync(
        context: TaskRealtimeSystemActionContext,
        limit: number,
    ): {
        hasMoreTasks: boolean;
        tasks: Array<TaskIndexDoc>;
    } {
        if (this._loadedBeforeCursor === "FullyLoaded") return {hasMoreTasks: false, tasks: []};

        const {hasMoreTasks, tasks} = this._query.getLoadedTasks({
            limit,
            afterCursor: this._loadedBeforeCursor !== "Unloaded" ? this._loadedBeforeCursor : null,
        });

        if (!hasMoreTasks) {
            this._loadedBeforeCursor = "FullyLoaded";
        } else if (tasks.length > 0) {
            this._loadedBeforeCursor = getTaskQueryNormalizedSortCursorFromIndexDoc(
                this._query.sorts,
                tasks[tasks.length - 1]!,
            );
        }

        for (const task of tasks) {
            this._onLoadedTaskAdd(context, task, "WillBackfill");
        }

        return {hasMoreTasks, tasks};
    }

    public onVisibleTaskAdd(
        context: TaskRealtimeSystemActionContext,
        newTask: TaskIndexDoc,
        actions: TaskRealtimeActionTransactionActionsSlice | "FromQueryLoadTasks",
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdBySubscription = getOrSetDefaultMapValue(
                assertExists(previousVisibleTaskIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                !previousTaskIdBySubscription.has(newTask.id),
                "Subscription can't add task that's already visible with `onVisibleTaskAdd()`",
            );

            previousTaskIdBySubscription.set(newTask.id, newTask);
        }

        if (actions === "FromQueryLoadTasks") {
            // When we call `loadMoreTasks()` on our query it will not add loaded tasks to
            // our subscription. You need to call `loadMoreTasks()` to make these new tasks
            // in the query loaded in the subscription.
            //
            // In test and development environments, confirm that the new visible task is
            // not loaded.
            if (process.env.NODE_ENV !== "production") {
                assert(
                    this._loadedBeforeCursor === "Unloaded" ||
                        (this._loadedBeforeCursor !== "FullyLoaded" &&
                            compareTaskQuerySortCursors(
                                this._query.sorts,
                                getTaskQueryNormalizedSortCursorFromIndexDoc(
                                    this._query.sorts,
                                    newTask,
                                ),
                                this._loadedBeforeCursor,
                            ) > 0),
                );
            }
        } else if (
            this._loadedBeforeCursor !== "Unloaded" &&
            (this._loadedBeforeCursor === "FullyLoaded" ||
                compareTaskQuerySortCursors(
                    this._query.sorts,
                    getTaskQueryNormalizedSortCursorFromIndexDoc(this._query.sorts, newTask),
                    this._loadedBeforeCursor,
                ) <= 0)
        ) {
            this._onLoadedTaskAdd(context, newTask, actions);
        }
    }

    public onVisibleTaskUpdate(
        context: TaskRealtimeSystemActionContext,
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
        actions: TaskRealtimeActionTransactionActionsSlice,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdBySubscription = getOrSetDefaultMapValue(
                assertExists(previousVisibleTaskIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskIdBySubscription.get(taskId) === oldTask,
                "Subscription must observe all updates to a visible task through `onVisibleTaskUpdate()`",
            );

            previousTaskIdBySubscription.set(taskId, newTask);
        }

        if (this._loadedBeforeCursor === "FullyLoaded") {
            this._onLoadedTaskUpdate(context, taskId, oldTask, newTask, actions);
        } else if (this._loadedBeforeCursor !== "Unloaded") {
            const oldCursor = getTaskQueryNormalizedSortCursorFromIndexDoc(
                this._query.sorts,
                oldTask,
            );
            const newCursor = getTaskQueryNormalizedSortCursorFromIndexDoc(
                this._query.sorts,
                newTask,
            );

            const oldCursorComparison = compareTaskQuerySortCursors(
                this._query.sorts,
                oldCursor,
                this._loadedBeforeCursor,
            );
            const newCursorComparison = compareTaskQuerySortCursors(
                this._query.sorts,
                newCursor,
                this._loadedBeforeCursor,
            );

            if (oldCursorComparison <= 0 && newCursorComparison > 0) {
                this._onLoadedTaskRemove(context, oldTask, actions);
            } else if (oldCursorComparison > 0 && newCursorComparison <= 0) {
                this._onLoadedTaskAdd(context, newTask, actions);
            } else if (oldCursorComparison <= 0 && newCursorComparison <= 0) {
                this._onLoadedTaskUpdate(context, taskId, oldTask, newTask, actions);
            }
        }
    }

    public onVisibleTaskRemove(
        context: TaskRealtimeSystemActionContext,
        oldTask: TaskIndexDoc,
        actions: TaskRealtimeActionTransactionActionsSlice,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdBySubscription = getOrSetDefaultMapValue(
                assertExists(previousVisibleTaskIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskIdBySubscription.get(oldTask.id) === oldTask,
                "Subscription can't remove task that is not visible with `onVisibleTaskRemove()`",
            );

            previousTaskIdBySubscription.delete(oldTask.id);
        }

        if (
            this._loadedBeforeCursor !== "Unloaded" &&
            (this._loadedBeforeCursor === "FullyLoaded" ||
                compareTaskQuerySortCursors(
                    this._query.sorts,
                    getTaskQueryNormalizedSortCursorFromIndexDoc(this._query.sorts, oldTask),
                    this._loadedBeforeCursor,
                ) <= 0)
        ) {
            this._onLoadedTaskRemove(context, oldTask, actions);
        }
    }

    private _onLoadedTaskAdd(
        context: TaskRealtimeSystemActionContext,
        newTask: TaskIndexDoc,
        actions: TaskRealtimeActionTransactionActionsSlice | "WillBackfill",
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdBySubscription = getOrSetDefaultMapValue(
                assertExists(previousLoadedTaskIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                !previousTaskIdBySubscription.has(newTask.id),
                "Subscription can't add task that's already loaded with `_onLoadedTaskAdd()`",
            );

            previousTaskIdBySubscription.set(newTask.id, newTask);
        }

        // 1. Increment the loaded count
        this._loadedCount++;

        // 2. Get a reference to the parent tasks of loaded tasks
        const newParentTaskId = newTask.parent.taskId.value;
        if (newParentTaskId) {
            const otherReferencedTaskEntry = getOrSetDefaultMapValue(
                this._otherReferencedTaskEntryById,
                newParentTaskId,
                () => ({
                    referenceCount: 0,
                    taskEntry: this._query.store
                        // NOCOMMIT: Retries
                        .loadTaskEntryIfExists(context, newParentTaskId)
                        .then(taskEntry => {
                            if (!taskEntry) throw new InternalError("Task not found");
                            taskEntry.addQuerySubscriptionDependent(this);
                            return taskEntry;
                        }),
                }),
            );

            otherReferencedTaskEntry.referenceCount++;
        }

        // 3. Get a reference to the collections of loaded tasks
        const newCollectionIds = new Set(
            newTask.collections.raw.collections.getArray().map(({collectionId}) => collectionId),
        );
        for (const newCollectionId of newCollectionIds) {
            const otherReferencedCollectionEntry = getOrSetDefaultMapValue(
                this._otherReferencedCollectionEntryById,
                newCollectionId,
                () => ({
                    referenceCount: 0,
                    collectionEntry: this._query.store
                        .loadCollectionEntryIfExists(context, newCollectionId)
                        .then(collectionEntry => {
                            if (!collectionEntry)
                                throw new InternalError("Task collection not found");
                            collectionEntry.addQuerySubscriptionDependent(this);
                            return collectionEntry;
                        }),
                }),
            );

            otherReferencedCollectionEntry.referenceCount++;
        }

        // 4. Report a backfill action to our callback. We can't report individual
        // actions because our client won't have the entire task. For example, if an
        // `UpdatePriority` action makes the task visible we need to send the entire
        // action, title and all, for the task to be rendered.
        //
        // If `actions` is `WillBackfill` then that means the caller is taking
        // responsibility for backfilling so we don't need to send a backfill
        // action to our callback here.
        if (actions !== "WillBackfill") {
            this._onAction(
                new TaskRealtimeActionTransactionBackfillTaskSlice(actions.transaction, newTask),
            );
        }
    }

    private _onLoadedTaskUpdate(
        context: TaskRealtimeSystemActionContext,
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
        actions: TaskRealtimeActionTransactionActionsSlice,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdBySubscription = getOrSetDefaultMapValue(
                assertExists(previousLoadedTaskIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskIdBySubscription.get(taskId) === oldTask,
                "Subscription must observe all updates to a loaded task through `_onLoadedTaskUpdate()`",
            );

            previousTaskIdBySubscription.set(taskId, newTask);
        }

        // 1. Loaded count stays the same

        // 2. If parent task updated then update our references
        const oldParentTaskId = oldTask.parent.taskId.value;
        const newParentTaskId = newTask.parent.taskId.value;

        if (oldParentTaskId !== newParentTaskId) {
            if (oldParentTaskId) {
                const otherReferencedTaskEntry = assertExists(
                    this._otherReferencedTaskEntryById.get(oldParentTaskId),
                );

                otherReferencedTaskEntry.referenceCount--;

                if (otherReferencedTaskEntry.referenceCount === 0) {
                    void otherReferencedTaskEntry.taskEntry.then(taskEntry => {
                        taskEntry.removeQuerySubscriptionDependent(this);
                    });
                    this._otherReferencedTaskEntryById.delete(oldParentTaskId);
                }
            }

            if (newParentTaskId) {
                const otherReferencedTaskEntry = getOrSetDefaultMapValue(
                    this._otherReferencedTaskEntryById,
                    newParentTaskId,
                    () => ({
                        referenceCount: 0,
                        taskEntry: this._query.store
                            .loadTaskEntryIfExists(context, newParentTaskId)
                            .then(taskEntry => {
                                if (!taskEntry) throw new InternalError("Task not found");
                                taskEntry.addQuerySubscriptionDependent(this);
                                return taskEntry;
                            }),
                    }),
                );

                otherReferencedTaskEntry.referenceCount++;
            }
        }

        // 3. If collections updated then update our references
        if (oldTask.collections.raw.collections !== newTask.collections.raw.collections) {
            const oldCollectionIds = new Set(
                oldTask.collections.raw.collections
                    .getArray()
                    .map(({collectionId}) => collectionId),
            );
            const newCollectionIds = new Set(
                newTask.collections.raw.collections
                    .getArray()
                    .map(({collectionId}) => collectionId),
            );

            const removedCollectionIds = diffSets(oldCollectionIds, newCollectionIds);
            const addedCollectionIds = diffSets(newCollectionIds, oldCollectionIds);

            for (const removedCollectionId of removedCollectionIds) {
                const otherReferencedCollectionEntry = assertExists(
                    this._otherReferencedCollectionEntryById.get(removedCollectionId),
                );

                otherReferencedCollectionEntry.referenceCount--;

                if (otherReferencedCollectionEntry.referenceCount === 0) {
                    void otherReferencedCollectionEntry.collectionEntry.then(collectionEntry => {
                        collectionEntry.removeQuerySubscriptionDependent(this);
                    });
                    this._otherReferencedCollectionEntryById.delete(removedCollectionId);
                }
            }

            for (const addedCollectionId of addedCollectionIds) {
                const otherReferencedCollectionEntry = getOrSetDefaultMapValue(
                    this._otherReferencedCollectionEntryById,
                    addedCollectionId,
                    () => ({
                        referenceCount: 0,
                        collectionEntry: this._query.store
                            .loadCollectionEntryIfExists(context, addedCollectionId)
                            .then(collectionEntry => {
                                if (!collectionEntry)
                                    throw new InternalError("Task collection not found");
                                collectionEntry.addQuerySubscriptionDependent(this);
                                return collectionEntry;
                            }),
                    }),
                );

                otherReferencedCollectionEntry.referenceCount++;
            }
        }

        // 4. Report these actions to our callback
        this._onAction(actions);
    }

    private _onLoadedTaskRemove(
        context: TaskRealtimeSystemActionContext,
        oldTask: TaskIndexDoc,
        actions: TaskRealtimeActionTransactionActionsSlice,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdBySubscription = getOrSetDefaultMapValue(
                assertExists(previousLoadedTaskIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskIdBySubscription.get(oldTask.id) === oldTask,
                "Subscription can't remove task that is not loaded with `_onLoadedTaskRemove()`",
            );

            previousTaskIdBySubscription.delete(oldTask.id);
        }

        // 1. Decrement loaded count
        this._loadedCount--;

        // 2. Remove the reference to the parent task of this loaded task
        const oldParentTaskId = oldTask.parent.taskId.value;
        if (oldParentTaskId) {
            const otherReferencedTaskEntry = assertExists(
                this._otherReferencedTaskEntryById.get(oldParentTaskId),
            );

            otherReferencedTaskEntry.referenceCount--;

            if (otherReferencedTaskEntry.referenceCount === 0) {
                void otherReferencedTaskEntry.taskEntry.then(taskEntry => {
                    taskEntry.removeQuerySubscriptionDependent(this);
                });
                this._otherReferencedTaskEntryById.delete(oldParentTaskId);
            }
        }

        // 3. Remove the references to the collections of this loaded task
        const oldCollectionIds = new Set(
            oldTask.collections.raw.collections.getArray().map(({collectionId}) => collectionId),
        );
        for (const oldCollectionId of oldCollectionIds) {
            const otherReferencedCollectionEntry = assertExists(
                this._otherReferencedCollectionEntryById.get(oldCollectionId),
            );

            otherReferencedCollectionEntry.referenceCount--;

            if (otherReferencedCollectionEntry.referenceCount === 0) {
                void otherReferencedCollectionEntry.collectionEntry.then(collectionEntry => {
                    collectionEntry.removeQuerySubscriptionDependent(this);
                });
                this._otherReferencedCollectionEntryById.delete(oldCollectionId);
            }
        }

        // 4. Report these actions to our callback
        this._onAction(actions);
    }
}

function diffSets<T>(set1: ReadonlySet<T>, set2: ReadonlySet<T>): Set<T> {
    const newSet = new Set<T>(set1);

    for (const item of set2) {
        newSet.delete(item);
    }

    return newSet;
}
