import {
    TaskClientReadonlyStore,
    TaskClientStoreInternal,
    TaskClientStoreTaskEntry,
} from "~/client/web/tasks/core/task_client_store.js";
import {TaskClientTaskReferencesSubscriptionBase} from "~/client/web/tasks/core/task_client_task_references_subscription_base.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

/**
 * Maintains a subscription to a single task outside of a query. Useful when
 * we're looking at a task detail view, for instance. We want to load just the
 * task visible in the detail view.
 */
export class TaskClientTaskSubscription extends TaskClientTaskReferencesSubscriptionBase {
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

    private readonly _store: TaskClientStoreInternal;
    public readonly taskId: TaskId;
    private readonly _taskEntryStoreWithoutError: Store<TaskClientStoreTaskEntry>;

    private readonly _errorStateStore = new ValueStore<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    /**
     * The task associated with this subscription. The task might be `null` if
     * our store hasn't seen it yet. `TaskRealtimeClient` is responsible for
     * subscribing to the task on the server.
     *
     * If the underlying subscription has an error then calling `getSnapshot()`
     * will throw the error.
     */
    public readonly taskEntryStore: Store<TaskClientStoreTaskEntry>;

    constructor(
        store: TaskClientStoreInternal,
        taskId: TaskId,
        taskEntryStore: Store<TaskClientStoreTaskEntry>,
    ) {
        super();
        this.store = store.external;
        this._store = store;
        this.taskId = taskId;
        this._taskEntryStoreWithoutError = taskEntryStore;

        this.taskEntryStore = Store.map(
            this._taskEntryStoreWithoutError,
            this._errorStateStore,
            (taskEntry, errorState) => {
                if (errorState.hasError) throw errorState.error;
                return taskEntry;
            },
        );

        // Add dependencies...
        this._trackTaskDependenciesFromAdd(this._taskEntryStoreWithoutError.getSnapshot());
    }

    protected override _getStore() {
        return this._store;
    }

    /**
     * Subscriptions start with 1 reference. The reference count can be increased
     * by calling `retain()` and decreased by calling `release()` once the
     * reference count reaches 0 the subscription is destroyed.
     */
    private _referenceCount = 1;

    /**
     * Add a reference for our subscription. You should call `release()` later when
     * you no longer need the reference. Once the subscription hits zero references
     * we will clean up this subscription and all its data.
     */
    public retain() {
        assert(this._referenceCount > 0, "Can’t retain a released subscription");

        this._referenceCount++;
    }

    /**
     * Release our reference to the subscription. Once the subscription hits zero
     * references we will clean up this subscription and all its data.
     */
    public release() {
        assert(this._referenceCount > 0, "Subscription is already released");

        this._referenceCount--;

        if (this._referenceCount === 0) {
            // Delete the subscription from our store.
            this._store.onTaskSubscriptionFinallyReleased(this);
        }
    }

    // This is a private function we expose publicly so `TaskClientStoreInternal`
    // can call it. To call you must prove you have access to a
    // `TaskClientStoreInternal` instance.
    //
    // We could also do a `TaskClientTaskSubscription`
    // `TaskClientTaskSubscriptionInternal` class split like we do for
    // `TaskClientQuery` but that feels like too much for two methods.
    public _onUnsubscribed(internal: TaskClientStoreInternal) {
        assert(internal instanceof TaskClientStoreInternal);

        // Remove dependencies...
        //
        // It's important that we use `taskEntryStoreWithoutError` instead of
        // `taskEntryStore` so unsubscribing due to an error doesn't break.
        this._trackTaskDependenciesFromRemove(this._taskEntryStoreWithoutError.getSnapshot());

        // Should have been cleared by removing all our loaded tasks.
        assert(this._referencedTaskEntryStoreById.size === 0);
        assert(this._referencedCollectionEntryStoreById.size === 0);
    }

    /**
     * If there was an error in our `TaskRealtimeService` subscription for this
     * task then this function is called to transition the task to an error
     * state. The error will be re-thrown in UI components when trying to access
     * the tasks's data.
     */
    public setError(error: unknown) {
        this._errorStateStore.set({hasError: true, error});
    }

    /**
     * If this task is in an erred state because `setError()` was previously
     * called then this function clears the error and allows normal operation to
     * resume.
     */
    public clearError() {
        this._errorStateStore.set(errorState =>
            errorState.hasError ? {hasError: false} : errorState,
        );
    }

    /**
     * Returns the store for the provided `TaskId` if it's loaded in this
     * subscription. Throws an error on tasks that aren't loaded. Only the
     * `TaskId` this subscription is directly for is considered loaded.
     * An easier way to access the store would be `subscription.taskEntryStore`.
     *
     * We include this function for compatibility with `TaskClientQuery`. Makes it
     * convenient to get the store you care about with the same method.
     */
    public getLoadedTaskEntryStore(taskId: TaskId): Store<TaskClientStoreTaskEntry> {
        assert(this.taskId === taskId);
        return this.taskEntryStore;
    }

    // This is a private function we expose publicly so `TaskClientStoreInternal`
    // can call it. To call you must prove you have access to a
    // `TaskClientStoreInternal` instance.
    //
    // We could also do a `TaskClientTaskSubscription`
    // `TaskClientTaskSubscriptionInternal` class split like we do for
    // `TaskClientQuery` but that feels like too much for two methods.
    public _onTasksUpdated(
        internal: TaskClientStoreInternal,
        taskEntryUpdateById: Map<
            TaskId,
            {
                taskEntryStore: ValueStore<TaskClientStoreTaskEntry>;
                oldTaskEntry: TaskClientStoreTaskEntry | null;
                newTaskEntry: TaskClientStoreTaskEntry;
            }
        >,
    ) {
        assert(internal instanceof TaskClientStoreInternal);

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

            {
                const taskEntryUpdate = taskEntryUpdateById.get(this.taskId);
                if (taskEntryUpdate) {
                    // If we have a subscription for this task then a task entry must have already
                    // existed in our store.
                    assert(taskEntryUpdate.oldTaskEntry);

                    this._trackTaskDependenciesFromUpdate(
                        taskEntryUpdate.oldTaskEntry,
                        taskEntryUpdate.newTaskEntry,
                    );
                }
            }
        } finally {
            this._onBeforeReferencedTaskAddOrRemove = null;
        }
    }
}
