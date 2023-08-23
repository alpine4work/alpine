import {getTaskQueryNormalizedSortCursorFromIndexDoc} from "~/server/tasks/data/get_task_query_normalized_sort_cursor_from_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {TaskRealtimeUpdateEventBuilder} from "~/server/tasks/realtime/task_realtime_event.js";
import {TaskRealtimeQuery} from "~/server/tasks/realtime/task_realtime_query.js";
import {
    TaskRealtimeQueryStoreCollectionEntry,
    TaskRealtimeQueryStoreTaskEntry,
} from "~/server/tasks/realtime/task_realtime_query_store.js";
import {TaskRealtimeSystemActionContext} from "~/server/tasks/realtime/task_realtime_system_action_context.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {
    TaskQuerySortCursor,
    compareTaskQuerySortCursors,
} from "~/shared/tasks/task_query_sort_cursor.js";

// Keep track of the previous task object the subscription saw so we can check
// if we've missed any updates. We run this validation in `development` and
// `test` since maintaining task update state correctly is a little tricky to
// get right but critical to the operation of this class.
const previousVisibleTaskByIdBySubscriptionForTest =
    process.env.NODE_ENV !== "production"
        ? new WeakMap<TaskRealtimeQuerySubscriptionInternal, Map<TaskId, TaskIndexDoc>>()
        : null;

const previousLoadedTaskByIdBySubscriptionForTest =
    process.env.NODE_ENV !== "production"
        ? new WeakMap<TaskRealtimeQuerySubscriptionInternal, Map<TaskId, TaskIndexDoc>>()
        : null;

const previousReferencedTaskByIdBySubscriptionForTest =
    process.env.NODE_ENV !== "production"
        ? new WeakMap<TaskRealtimeQuerySubscriptionInternal, Map<TaskId, TaskIndexDoc>>()
        : null;

export type TaskRealtimeQuerySubscriptionCallbacks = {
    /**
     * A task is added to the query subscription's loaded range. May happen when:
     *
     * 1. Loading more tasks into the query
     * 2. An action transaction changes a task's filters or sorts such that the
     *    task is now in the loaded range
     *
     * In case 2 we may have some `TaskAction`s that represent the change but not
     * in case 1. In both cases we should send the client a backfill event since
     * this is the first time the client is seeing the task.
     */
    onLoadedTaskAdd(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        newTask: TaskIndexDoc,
    ): void;

    /**
     * A task in the query subscription's loaded range is updated.
     *
     * There will always be some associated `TaskAction`s that caused the change.
     * Clients should apply these actions locally.
     */
    onLoadedTaskUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ): void;

    /**
     * A task in the query subscription's loaded range is removed. After this you
     * will no longer receive updates to the task. If the task is added back you
     * will get an "add" event and we expect you to send a backfill to clients.
     *
     * There will always be some associated `TaskAction`s that caused the change.
     * Clients should apply these actions locally.
     */
    onLoadedTaskRemove(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        oldTask: TaskIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ): void;

    /**
     * A new task is referenced by a loaded task in the query directly or
     * indirectly. All parent tasks of our loaded tasks are considered referenced
     * and all parent tasks of parent tasks recursively are considered referenced.
     *
     * May happen when:
     *
     * 1. Loading more tasks into the query
     * 2. A loaded task's parent is updated
     * 3. A loaded task's parent's parent is updated (recursively)
     *
     * You are expected to send a backfill message to clients with a preview of the
     * referenced task. The client may not have seen relevant actions leading up to
     * this event.
     */
    onReferencedTaskAdd(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        newTask: TaskIndexDoc,
    ): void;

    /**
     * A task referenced directly or indirectly by a loaded task was updated.
     *
     * There will always be some associated `TaskAction`s with this change. Clients
     * should apply these task actions.
     */
    onReferencedTaskUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ): void;

    /**
     * A task that was referenced directly or indirectly by a loaded task is no
     * longer referenced.
     *
     * We don't need to apply any new `TaskAction`s to this task since it should
     * disappear on the client. If the task is referenced again then you will get
     * an add event.
     */
    onReferencedTaskRemove(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        oldTask: TaskIndexDoc,
    ): void;
};

// NOCOMMIT: Error handling needs to live in this public class too.
export class TaskRealtimeQuerySubscription {
    private readonly _internal: TaskRealtimeQuerySubscriptionInternal;

    constructor(query: TaskRealtimeQuery, callbacks: TaskRealtimeQuerySubscriptionCallbacks) {
        this._internal = new TaskRealtimeQuerySubscriptionInternal(query, callbacks);
    }

    public unsubscribe() {
        this._internal.unsubscribe();
    }

    public getFilters() {
        return this._internal.query.filters;
    }

    public getSorts() {
        return this._internal.query.sorts;
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
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        limit: number,
    ): Promise<void> {
        return this._internal.loadMoreTasks(context, eventBuilder, limit);
    }
}

// Our subscription implementation has some public methods that
// `TaskRealtimeQuery` is allowed to call but external users of
// `TaskRealtimeQueryStore` should not (e.g. `onQueryTasksLoad`). These methods
// are public on this internal class and we have a wrapper
// `TaskRealtimeQuerySubscription` class with a public interface.
export class TaskRealtimeQuerySubscriptionInternal {
    public readonly query: TaskRealtimeQuery;
    private readonly _callbacks: TaskRealtimeQuerySubscriptionCallbacks;
    private _loadedBeforeCursor: TaskQuerySortCursor | "FullyLoaded" | "Unloaded" = "Unloaded";
    private _loadedCount = 0;

    private readonly _referencedTaskEntryById = new Map<
        TaskId,
        {
            referenceCount: number;
            taskEntry: Promise<TaskRealtimeQueryStoreTaskEntry>;
        }
    >();

    private readonly _referencedCollectionEntryById = new Map<
        TaskCollectionId,
        {
            referenceCount: number;
            collectionEntry: Promise<TaskRealtimeQueryStoreCollectionEntry>;
        }
    >();

    constructor(query: TaskRealtimeQuery, callbacks: TaskRealtimeQuerySubscriptionCallbacks) {
        this.query = query;
        this._callbacks = callbacks;

        this.query.addSubscription(this);
    }

    public unsubscribe() {
        // NOCOMMIT: Do `removeQuerySubscriptionDependent()` calls. Maybe flip a "dead"
        // flag and throw if we try to use after?
        //
        // NOCOMMIT: `assertCorrectForTest()`
        this.query.removeSubscription(this);
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
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        limit: number,
    ): Promise<void> {
        await this.query.loadMoreTasks(
            context,
            this._loadedCount + limit - this.query.getLoadedTaskCount(),
        );

        this._loadMoreTasksSync(context, eventBuilder, limit);
    }

    // Synchronous part of `loadMoreTasks()`. Advances our subscription's internal
    // state synchronously. We enforce this part is synchronous so we know that no
    // concurrent actions will happen while we're updating our state.
    private _loadMoreTasksSync(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        limit: number,
    ): {
        hasMoreTasks: boolean;
        tasks: Array<TaskIndexDoc>;
    } {
        if (this._loadedBeforeCursor === "FullyLoaded") return {hasMoreTasks: false, tasks: []};

        // NOCOMMIT: I don't need `tasks` anymore. Can I make this more efficient? By
        // just getting the `loadedBeforeCursor`?
        const {hasMoreTasks, tasks} = this.query.getLoadedTasks({
            limit,
            afterCursor: this._loadedBeforeCursor !== "Unloaded" ? this._loadedBeforeCursor : null,
        });

        if (!hasMoreTasks) {
            this._loadedBeforeCursor = "FullyLoaded";
        } else if (tasks.length > 0) {
            this._loadedBeforeCursor = getTaskQueryNormalizedSortCursorFromIndexDoc(
                this.query.sorts,
                tasks[tasks.length - 1]!,
            );
        }

        for (const task of tasks) {
            this._onLoadedTaskAdd(context, eventBuilder, task);
        }

        return {hasMoreTasks, tasks};
    }

    public onVisibleButNotLoadedTaskAddForTest(
        context: TaskRealtimeSystemActionContext,
        newTask: TaskIndexDoc,
    ) {
        assert(process.env.NODE_ENV !== "production");

        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        const previousTaskIdBySubscription = getOrSetDefaultMapValue(
            assertExists(previousVisibleTaskByIdBySubscriptionForTest),
            this,
            () => new Map(),
        );

        assert(
            !previousTaskIdBySubscription.has(newTask.id),
            "Subscription can't add task that's already visible with `onVisibleTaskAdd()`",
        );

        previousTaskIdBySubscription.set(newTask.id, newTask);

        assert(
            this._loadedBeforeCursor === "Unloaded" ||
                (this._loadedBeforeCursor !== "FullyLoaded" &&
                    compareTaskQuerySortCursors(
                        this.query.sorts,
                        getTaskQueryNormalizedSortCursorFromIndexDoc(this.query.sorts, newTask),
                        this._loadedBeforeCursor,
                    ) > 0),
        );
    }

    public onVisibleTaskAdd(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        newTask: TaskIndexDoc,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdBySubscription = getOrSetDefaultMapValue(
                assertExists(previousVisibleTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                !previousTaskIdBySubscription.has(newTask.id),
                "Subscription can't add task that's already visible with `onVisibleTaskAdd()`",
            );

            previousTaskIdBySubscription.set(newTask.id, newTask);
        }

        if (
            this._loadedBeforeCursor !== "Unloaded" &&
            (this._loadedBeforeCursor === "FullyLoaded" ||
                compareTaskQuerySortCursors(
                    this.query.sorts,
                    getTaskQueryNormalizedSortCursorFromIndexDoc(this.query.sorts, newTask),
                    this._loadedBeforeCursor,
                ) <= 0)
        ) {
            this._onLoadedTaskAdd(context, eventBuilder, newTask);
        }
    }

    public onVisibleTaskUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdBySubscription = getOrSetDefaultMapValue(
                assertExists(previousVisibleTaskByIdBySubscriptionForTest),
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
            this._onLoadedTaskUpdate(context, eventBuilder, taskId, oldTask, newTask, actions);
        } else if (this._loadedBeforeCursor !== "Unloaded") {
            const oldCursor = getTaskQueryNormalizedSortCursorFromIndexDoc(
                this.query.sorts,
                oldTask,
            );
            const newCursor = getTaskQueryNormalizedSortCursorFromIndexDoc(
                this.query.sorts,
                newTask,
            );

            const oldCursorComparison = compareTaskQuerySortCursors(
                this.query.sorts,
                oldCursor,
                this._loadedBeforeCursor,
            );
            const newCursorComparison = compareTaskQuerySortCursors(
                this.query.sorts,
                newCursor,
                this._loadedBeforeCursor,
            );

            if (oldCursorComparison <= 0 && newCursorComparison > 0) {
                this._onLoadedTaskRemove(context, eventBuilder, oldTask, actions);
            } else if (oldCursorComparison > 0 && newCursorComparison <= 0) {
                this._onLoadedTaskAdd(context, eventBuilder, newTask);
            } else if (oldCursorComparison <= 0 && newCursorComparison <= 0) {
                this._onLoadedTaskUpdate(context, eventBuilder, taskId, oldTask, newTask, actions);
            }
        }
    }

    public onVisibleTaskRemove(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        oldTask: TaskIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdBySubscription = getOrSetDefaultMapValue(
                assertExists(previousVisibleTaskByIdBySubscriptionForTest),
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
                    this.query.sorts,
                    getTaskQueryNormalizedSortCursorFromIndexDoc(this.query.sorts, oldTask),
                    this._loadedBeforeCursor,
                ) <= 0)
        ) {
            this._onLoadedTaskRemove(context, eventBuilder, oldTask, actions);
        }
    }

    private _onLoadedTaskAdd(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        newTask: TaskIndexDoc,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdBySubscription = getOrSetDefaultMapValue(
                assertExists(previousLoadedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                !previousTaskIdBySubscription.has(newTask.id),
                "Subscription can't add task that's already loaded with `_onLoadedTaskAdd()`",
            );

            previousTaskIdBySubscription.set(newTask.id, newTask);
        }

        this._loadedCount++;

        this._trackTaskDependenciesFromAdd(context, eventBuilder, newTask);

        this._callbacks.onLoadedTaskAdd(eventBuilder, newTask);
    }

    private _onLoadedTaskUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdBySubscription = getOrSetDefaultMapValue(
                assertExists(previousLoadedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskIdBySubscription.get(taskId) === oldTask,
                "Subscription must observe all updates to a loaded task through `_onLoadedTaskUpdate()`",
            );

            previousTaskIdBySubscription.set(taskId, newTask);
        }

        this._trackTaskDependenciesFromUpdate(context, eventBuilder, taskId, oldTask, newTask);

        this._callbacks.onLoadedTaskUpdate(eventBuilder, taskId, oldTask, newTask, actions);
    }

    private _onLoadedTaskRemove(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        oldTask: TaskIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdBySubscription = getOrSetDefaultMapValue(
                assertExists(previousLoadedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskIdBySubscription.get(oldTask.id) === oldTask,
                "Subscription can't remove task that is not loaded with `_onLoadedTaskRemove()`",
            );

            previousTaskIdBySubscription.delete(oldTask.id);
        }

        this._loadedCount--;

        this._trackTaskDependenciesFromRemove(context, eventBuilder, oldTask);

        this._callbacks.onLoadedTaskRemove(eventBuilder, oldTask, actions);
    }

    private _onReferencedTaskAdd(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        newTask: TaskIndexDoc,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdBySubscription = getOrSetDefaultMapValue(
                assertExists(previousReferencedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                !previousTaskIdBySubscription.has(newTask.id),
                "Subscription can't add task that's already referenced with `_onReferencedTaskAdd()`",
            );

            previousTaskIdBySubscription.set(newTask.id, newTask);
        }

        this._trackTaskDependenciesFromAdd(context, eventBuilder, newTask);

        this._callbacks.onReferencedTaskAdd(eventBuilder, newTask);
    }

    public onReferencedTaskUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdBySubscription = getOrSetDefaultMapValue(
                assertExists(previousReferencedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskIdBySubscription.get(taskId) === oldTask,
                "Subscription must observe all updates to a referenced task through `onReferencedTaskUpdate()`",
            );

            previousTaskIdBySubscription.set(taskId, newTask);
        }

        this._trackTaskDependenciesFromUpdate(context, eventBuilder, taskId, oldTask, newTask);

        this._callbacks.onReferencedTaskUpdate(eventBuilder, taskId, oldTask, newTask, actions);
    }

    private _onReferencedTaskRemove(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        oldTask: TaskIndexDoc,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskIdBySubscription = getOrSetDefaultMapValue(
                assertExists(previousReferencedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskIdBySubscription.get(oldTask.id) === oldTask,
                "Subscription can't remove task that is not referenced with `_onReferencedTaskRemove()`",
            );

            previousTaskIdBySubscription.delete(oldTask.id);
        }

        this._trackTaskDependenciesFromRemove(context, eventBuilder, oldTask);

        this._callbacks.onReferencedTaskRemove(eventBuilder, oldTask);
    }

    private _trackTaskDependenciesFromAdd(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        newTask: TaskIndexDoc,
    ) {
        // Get a reference to the parent tasks of loaded tasks
        const newParentTaskId = newTask.parent.taskId.value;
        if (newParentTaskId) {
            const referencedTaskEntry = getOrSetDefaultMapValue(
                this._referencedTaskEntryById,
                newParentTaskId,
                () => {
                    const taskEntryPromise = this.query.store
                        .loadTaskEntry(context, newParentTaskId)
                        .then(taskEntry => {
                            taskEntry.addQuerySubscriptionDependent(this);
                            this._onReferencedTaskAdd(context, eventBuilder, taskEntry.task);
                            return taskEntry;
                        });

                    eventBuilder.waitUntil(taskEntryPromise);

                    return {
                        referenceCount: 0,
                        taskEntry: taskEntryPromise,
                    };
                },
            );

            referencedTaskEntry.referenceCount++;
        }

        // Get a reference to the collections of loaded tasks
        const newCollectionIds = new Set(
            newTask.collections.raw.collections.getArray().map(({collectionId}) => collectionId),
        );
        for (const newCollectionId of newCollectionIds) {
            const referencedCollectionEntry = getOrSetDefaultMapValue(
                this._referencedCollectionEntryById,
                newCollectionId,
                () => ({
                    referenceCount: 0,
                    collectionEntry: this.query.store
                        .loadCollectionEntry(context, newCollectionId)
                        .then(collectionEntry => {
                            collectionEntry.addQuerySubscriptionDependent(this);
                            return collectionEntry;
                        }),
                }),
            );

            referencedCollectionEntry.referenceCount++;
        }
    }

    private _trackTaskDependenciesFromUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
    ) {
        // If parent task updated then update our references
        const oldParentTaskId = oldTask.parent.taskId.value;
        const newParentTaskId = newTask.parent.taskId.value;

        if (oldParentTaskId !== newParentTaskId) {
            if (oldParentTaskId) {
                const referencedTaskEntry = assertExists(
                    this._referencedTaskEntryById.get(oldParentTaskId),
                );

                referencedTaskEntry.referenceCount--;

                if (referencedTaskEntry.referenceCount === 0) {
                    eventBuilder.waitUntil(
                        referencedTaskEntry.taskEntry.then(taskEntry => {
                            taskEntry.removeQuerySubscriptionDependent(this);
                            this._onReferencedTaskRemove(context, eventBuilder, taskEntry.task);
                        }),
                    );
                    this._referencedTaskEntryById.delete(oldParentTaskId);
                }
            }

            if (newParentTaskId) {
                const referencedTaskEntry = getOrSetDefaultMapValue(
                    this._referencedTaskEntryById,
                    newParentTaskId,
                    () => {
                        const taskEntryPromise = this.query.store
                            .loadTaskEntry(context, newParentTaskId)
                            .then(taskEntry => {
                                taskEntry.addQuerySubscriptionDependent(this);
                                this._onReferencedTaskAdd(context, eventBuilder, taskEntry.task);
                                return taskEntry;
                            });

                        eventBuilder.waitUntil(taskEntryPromise);

                        return {
                            referenceCount: 0,
                            taskEntry: taskEntryPromise,
                        };
                    },
                );

                referencedTaskEntry.referenceCount++;
            }
        }

        // If collections updated then update our references
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
                const referencedCollectionEntry = assertExists(
                    this._referencedCollectionEntryById.get(removedCollectionId),
                );

                referencedCollectionEntry.referenceCount--;

                if (referencedCollectionEntry.referenceCount === 0) {
                    void referencedCollectionEntry.collectionEntry.then(collectionEntry => {
                        collectionEntry.removeQuerySubscriptionDependent(this);
                    });
                    this._referencedCollectionEntryById.delete(removedCollectionId);
                }
            }

            for (const addedCollectionId of addedCollectionIds) {
                const referencedCollectionEntry = getOrSetDefaultMapValue(
                    this._referencedCollectionEntryById,
                    addedCollectionId,
                    () => ({
                        referenceCount: 0,
                        collectionEntry: this.query.store
                            .loadCollectionEntry(context, addedCollectionId)
                            .then(collectionEntry => {
                                collectionEntry.addQuerySubscriptionDependent(this);
                                return collectionEntry;
                            }),
                    }),
                );

                referencedCollectionEntry.referenceCount++;
            }
        }
    }

    private _trackTaskDependenciesFromRemove(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilder,
        oldTask: TaskIndexDoc,
    ) {
        // Remove the reference to the parent task of this loaded task
        const oldParentTaskId = oldTask.parent.taskId.value;
        if (oldParentTaskId) {
            const referencedTaskEntry = assertExists(
                this._referencedTaskEntryById.get(oldParentTaskId),
            );

            referencedTaskEntry.referenceCount--;

            if (referencedTaskEntry.referenceCount === 0) {
                eventBuilder.waitUntil(
                    referencedTaskEntry.taskEntry.then(taskEntry => {
                        taskEntry.removeQuerySubscriptionDependent(this);
                        this._onReferencedTaskRemove(context, eventBuilder, taskEntry.task);
                    }),
                );
                this._referencedTaskEntryById.delete(oldParentTaskId);
            }
        }

        // Remove the references to the collections of this loaded task
        const oldCollectionIds = new Set(
            oldTask.collections.raw.collections.getArray().map(({collectionId}) => collectionId),
        );
        for (const oldCollectionId of oldCollectionIds) {
            const referencedCollectionEntry = assertExists(
                this._referencedCollectionEntryById.get(oldCollectionId),
            );

            referencedCollectionEntry.referenceCount--;

            if (referencedCollectionEntry.referenceCount === 0) {
                void referencedCollectionEntry.collectionEntry.then(collectionEntry => {
                    collectionEntry.removeQuerySubscriptionDependent(this);
                });
                this._referencedCollectionEntryById.delete(oldCollectionId);
            }
        }
    }
}

function diffSets<T>(set1: ReadonlySet<T>, set2: ReadonlySet<T>): Set<T> {
    const newSet = new Set<T>(set1);

    for (const item of set2) {
        newSet.delete(item);
    }

    return newSet;
}
