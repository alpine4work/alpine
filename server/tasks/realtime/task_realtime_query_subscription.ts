import {getTaskQueryNormalizedSortCursorForIndexDoc} from "~/server/tasks/data/get_task_query_normalized_sort_cursor_for_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    TaskRealtimeProcessContext,
    TaskRealtimeSystemActionContext,
} from "~/server/tasks/data/task_realtime_context.js";
import {TaskRealtimeQuery} from "~/server/tasks/realtime/task_realtime_query.js";
import {
    TaskRealtimeTaskReferencesSubscriptionBase,
    TaskRealtimeTaskReferencesSubscriptionCallbacks,
} from "~/server/tasks/realtime/task_realtime_task_references_subscription_base.js";
import {
    TaskRealtimeUnsubscribeUpdateEventBuilder,
    TaskRealtimeUpdateEventBuilderBase,
} from "~/server/tasks/realtime/task_realtime_update_event_builder.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {CancelledError, InternalError} from "~/shared/error/error.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {
    TaskQuerySortCursor,
    compareTaskQuerySortCursors,
} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskRealtimeQueryLoadedState} from "~/shared/tasks/task_realtime_protocol.js";

// Keep track of the previous task object the subscription saw so we can check
// if we've missed any updates. We run this validation in `development` and
// `test` since maintaining task update state correctly is a little tricky to
// get right but critical to the operation of this class.
const previousLoadedTaskByIdBySubscriptionForTest =
    process.env.NODE_ENV !== "production"
        ? new WeakMap<TaskRealtimeQuerySubscriptionInternal, Map<TaskId, TaskIndexDoc>>()
        : null;

export type TaskRealtimeQuerySubscriptionCallbacks =
    TaskRealtimeTaskReferencesSubscriptionCallbacks & {
        /**
         * An unexpected internal server error has occurred which has caused the
         * subscription to disconnect. The subscription will receive no more events
         * after this. Subscribers should present an error to users or attempt to
         * reconnect.
         */
        onFatalError(context: TaskRealtimeProcessContext, error: InternalError): void;

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
            eventBuilder: TaskRealtimeUpdateEventBuilderBase,
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
            eventBuilder: TaskRealtimeUpdateEventBuilderBase,
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
            eventBuilder: TaskRealtimeUpdateEventBuilderBase,
            oldTask: TaskIndexDoc,
            actions: ReadonlyArray<TaskAction>,
        ): void;
    };

export class TaskRealtimeQuerySubscription {
    private readonly _internal: TaskRealtimeQuerySubscriptionInternal;
    private readonly _withFatalErrorHandling: <Value>(
        context: TaskRealtimeSystemActionContext,
        action: () => Promise<Value>,
    ) => Promise<Value>;

    constructor(
        query: TaskRealtimeQuery,
        callbacks: TaskRealtimeQuerySubscriptionCallbacks,
        withFatalErrorHandling: <Value>(
            context: TaskRealtimeSystemActionContext,
            action: () => Promise<Value>,
        ) => Promise<Value>,
    ) {
        this._internal = new TaskRealtimeQuerySubscriptionInternal(query, callbacks);
        this._withFatalErrorHandling = withFatalErrorHandling;
    }

    public unsubscribe(context: Context<{process: ProcessContextModule}>): Promise<void> {
        return this._internal.unsubscribe(context);
    }

    public getFilters() {
        return this._internal.query.filters;
    }

    public getSorts() {
        return this._internal.query.sorts;
    }

    public getLoadedTasks() {
        return this._internal.getLoadedTasks();
    }

    /**
     * Load more tasks into our subscription.
     *
     * Our subscription maintains a different loaded task count than the underlying
     * query. If another subscription has already fully loaded the query then this
     * call will not make a network request and instead only update our
     * subscription's state.
     *
     * Returns the current loaded state of our subscription.
     */
    public loadMoreTasks(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        limit: number,
    ): Promise<{
        loadedState: TaskRealtimeQueryLoadedState;
        tasks: Array<TaskIndexDoc>;
    }> {
        return this._withFatalErrorHandling(context, () =>
            this._internal.loadMoreTasks(context, eventBuilder, limit),
        );
    }
}

// Our subscription implementation has some public methods that
// `TaskRealtimeQuery` is allowed to call but external users of
// `TaskRealtimeStore` should not (e.g. `onQueryTasksLoad`). These methods
// are public on this internal class and we have a wrapper
// `TaskRealtimeQuerySubscription` class with a public interface.
export class TaskRealtimeQuerySubscriptionInternal extends TaskRealtimeTaskReferencesSubscriptionBase {
    public readonly query: TaskRealtimeQuery;
    protected readonly _callbacks: TaskRealtimeQuerySubscriptionCallbacks;
    protected _isSubscribed = true;
    private _loadedBeforeCursor: TaskQuerySortCursor | "FullyLoaded" | "Unloaded" = "Unloaded";
    private _loadedCount = 0;

    constructor(query: TaskRealtimeQuery, callbacks: TaskRealtimeQuerySubscriptionCallbacks) {
        super();
        this.query = query;
        this._callbacks = callbacks;

        this.query.addSubscription(this);

        // All of the current query visible tasks are also considered visible in our
        // subscription. However we don't need to call `onVisibleTaskAdd()` because we
        // only track state for tasks considered loaded in this subscription (tasks
        // less than `loadedBeforeCursor`) which will be no tasks when the query
        // subscription initializes.
    }

    protected override _getStore() {
        return this.query.store;
    }

    public assertCorrectForTest() {
        // We run this validation in `development` and `test` since maintaining state
        // correctly across the store and query class is a little tricky to get right
        // but critical to the operation of the task realtime service.
        assert(process.env.NODE_ENV !== "production");

        const expectedLoadedCount = this.query.getSubscriptionExpectedLoadedCountForTest(
            this._loadedBeforeCursor,
        );

        assert(
            this._loadedCount === expectedLoadedCount,
            "Query subscription loaded task count does not equal expected loaded task count",
        );

        const {tasks} = this.query.getLoadedTasks({limit: this._loadedCount, afterCursor: null});

        assert(
            tasks.length > 0 ||
                (this._referencedTaskEntryById.size === 0 &&
                    this._referencedCollectionEntryById.size === 0),
            "If query subscription has no loaded tasks then it shouldn\u2019t have referenced tasks or referenced collections either",
        );

        for (const task of tasks) {
            if (task.parent.taskId.value) {
                assert(
                    this._referencedTaskEntryById.has(task.parent.taskId.value),
                    "Query subscription should keep track of loaded tasks\u2019 parent tasks",
                );
            }

            for (const {collectionId} of task.collections.raw.collections.getArray()) {
                assert(
                    this._referencedCollectionEntryById.has(collectionId),
                    "Query subscription should keep track of loaded tasks\u2019 collections",
                );
            }
        }
    }

    /**
     * Unsubscribe from the query. Will call the callbacks `onLoadedTaskRemove`,
     * `onReferencedTaskRemove`, and `onReferencedCollectionRemove` for all tasks
     * and collections that appeared in our query.
     */
    public unsubscribe(context: Context<{process: ProcessContextModule}>): Promise<void> {
        assert(this._isSubscribed);
        this._isSubscribed = false;

        this.query.removeSubscription(this);

        const {tasks} = this.query.getLoadedTasks({limit: this._loadedCount, afterCursor: null});

        // We construct an event builder just so we can wait out `waitUntil()`
        // promises.
        const eventBuilder = new TaskRealtimeUnsubscribeUpdateEventBuilder(
            this.query.store.spaceId,
        );

        for (const task of tasks) {
            this._onLoadedTaskRemove(context, eventBuilder, task, []);
        }

        return eventBuilder.finishAndIgnoreEvents();
    }

    /**
     * Get the tasks currently loaded in our subscription.
     */
    public getLoadedTasks() {
        return this.query.getLoadedTasks({
            limit: this._loadedCount,
            afterCursor: null,
        });
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
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        limit: number,
    ): Promise<{
        loadedState: TaskRealtimeQueryLoadedState;
        tasks: Array<TaskIndexDoc>;
    }> {
        assert(this._isSubscribed);

        await this.query.loadMoreTasks(
            context,
            this._loadedCount + limit - this.query.getLoadedTaskCount(),
        );

        // If our subscription was unsubscribed while we are loading, don't continue
        // updating the subscription's state.
        if (!this._isSubscribed)
            throw new CancelledError("Query subscription was unsubscribed while loading data");

        return this._loadMoreTasksSync(context, eventBuilder, limit);
    }

    // Synchronous part of `loadMoreTasks()`. Advances our subscription's internal
    // state synchronously. We enforce this part is synchronous so we know that no
    // concurrent actions will happen while we're updating our state.
    private _loadMoreTasksSync(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        limit: number,
    ): {
        loadedState: TaskRealtimeQueryLoadedState;
        tasks: Array<TaskIndexDoc>;
    } {
        if (this._loadedBeforeCursor === "FullyLoaded")
            return {loadedState: {type: "Full"}, tasks: []};

        const result = this.query.getLoadedTasks({
            limit,
            afterCursor: this._loadedBeforeCursor !== "Unloaded" ? this._loadedBeforeCursor : null,
        });

        this._loadedBeforeCursor =
            result.loadedState.type === "Full"
                ? "FullyLoaded"
                : (result.loadedState.endCursor ?? "Unloaded");

        for (const task of result.tasks) {
            this._onLoadedTaskAdd(context, eventBuilder, task);
        }

        return result;
    }

    public onVisibleTaskAdd(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        newTask: TaskIndexDoc,
    ) {
        assert(this._isSubscribed);

        if (
            this._loadedBeforeCursor !== "Unloaded" &&
            (this._loadedBeforeCursor === "FullyLoaded" ||
                compareTaskQuerySortCursors(
                    this.query.sorts,
                    getTaskQueryNormalizedSortCursorForIndexDoc(this.query.sorts, newTask),
                    this._loadedBeforeCursor,
                ) <= 0)
        ) {
            this._onLoadedTaskAdd(context, eventBuilder, newTask);
        }
    }

    public onVisibleTaskUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ) {
        assert(this._isSubscribed);

        if (this._loadedBeforeCursor === "FullyLoaded") {
            this._onLoadedTaskUpdate(context, eventBuilder, taskId, oldTask, newTask, actions);
        } else if (this._loadedBeforeCursor !== "Unloaded") {
            const oldCursor = getTaskQueryNormalizedSortCursorForIndexDoc(
                this.query.sorts,
                oldTask,
            );
            const newCursor = getTaskQueryNormalizedSortCursorForIndexDoc(
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
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        oldTask: TaskIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ) {
        assert(this._isSubscribed);

        if (
            this._loadedBeforeCursor !== "Unloaded" &&
            (this._loadedBeforeCursor === "FullyLoaded" ||
                compareTaskQuerySortCursors(
                    this.query.sorts,
                    getTaskQueryNormalizedSortCursorForIndexDoc(this.query.sorts, oldTask),
                    this._loadedBeforeCursor,
                ) <= 0)
        ) {
            this._onLoadedTaskRemove(context, eventBuilder, oldTask, actions);
        }
    }

    private _onLoadedTaskAdd(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        newTask: TaskIndexDoc,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskById = getOrSetDefaultMapValue(
                assertExists(previousLoadedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                !previousTaskById.has(newTask.id),
                "Subscription can\u2019t add task that\u2019s already loaded with `_onLoadedTaskAdd()`",
            );

            previousTaskById.set(newTask.id, newTask);
        }

        this._loadedCount++;

        this._trackTaskDependenciesFromAdd(context, eventBuilder, newTask);

        this._callbacks.onLoadedTaskAdd(context, eventBuilder, newTask);
    }

    private _onLoadedTaskUpdate(
        context: TaskRealtimeSystemActionContext,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        taskId: TaskId,
        oldTask: TaskIndexDoc,
        newTask: TaskIndexDoc,
        actions: NonEmptyReadonlyArray<TaskAction>,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskById = getOrSetDefaultMapValue(
                assertExists(previousLoadedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskById.get(taskId) === oldTask,
                "Subscription must observe all updates to a loaded task through `_onLoadedTaskUpdate()`",
            );

            previousTaskById.set(taskId, newTask);
        }

        this._trackTaskDependenciesFromUpdate(context, eventBuilder, taskId, oldTask, newTask);

        this._callbacks.onLoadedTaskUpdate(
            context,
            eventBuilder,
            taskId,
            oldTask,
            newTask,
            actions,
        );
    }

    private _onLoadedTaskRemove(
        context: Context<{process: ProcessContextModule}>,
        eventBuilder: TaskRealtimeUpdateEventBuilderBase,
        oldTask: TaskIndexDoc,
        actions: ReadonlyArray<TaskAction>,
    ) {
        // When testing, keep track of the tasks we've seen so we can guarantee we've
        // seen every relevant update for a task.
        if (process.env.NODE_ENV !== "production") {
            const previousTaskById = getOrSetDefaultMapValue(
                assertExists(previousLoadedTaskByIdBySubscriptionForTest),
                this,
                () => new Map(),
            );

            assert(
                previousTaskById.get(oldTask.id) === oldTask,
                "Subscription can\u2019t remove task that is not loaded with `_onLoadedTaskRemove()`",
            );

            previousTaskById.delete(oldTask.id);
        }

        this._loadedCount--;

        this._trackTaskDependenciesFromRemove(context, eventBuilder, oldTask);

        this._callbacks.onLoadedTaskRemove(eventBuilder, oldTask, actions);
    }

    public onFatalError(context: TaskRealtimeProcessContext, error: InternalError) {
        try {
            this._callbacks.onFatalError(context, error);
        } catch (error) {
            // Treat errors from our error callback as uncaught exceptions.
            scheduleUncaughtError(error);
        }
    }
}
