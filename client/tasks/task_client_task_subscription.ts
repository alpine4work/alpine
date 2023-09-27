import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {Store} from "~/client/helpers/store/store.js";
import {ValueStore} from "~/client/helpers/store/value_store.js";
import {
    TaskClientStore,
    TaskClientStoreInternal,
    TaskClientStoreTaskEntry,
} from "~/client/tasks/task_client_store.js";
import {TaskClientTaskReferencesSubscriptionBase} from "~/client/tasks/task_client_task_references_subscription_base.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TaskId} from "~/shared/id/types/id_types.js";

/**
 * Maintains a subscription to a single task outside of a query. Useful when
 * we're looking at a task detail view, for instance. We want to load just the
 * task visible in the detail view.
 */
export class TaskClientTaskSubscription extends TaskClientTaskReferencesSubscriptionBase {
    public readonly store: TaskClientStore;
    private readonly _store: TaskClientStoreInternal;
    public readonly taskId: TaskId;
    private readonly _taskEntryStore: ValueStore<Store<TaskClientStoreTaskEntry>>;

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
        this._taskEntryStore = new ValueStore(taskEntryStore);

        this.taskEntryStore = Store.map(
            this._taskEntryStore.flat(),
            this._errorStateStore,
            (taskEntry, errorState) => {
                if (errorState.hasError) throw errorState.error;
                return taskEntry;
            },
        );

        // Add dependencies...
        this._trackTaskDependenciesFromAdd(this._taskEntryStore.getSnapshot().getSnapshot());
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
        this._referenceCount++;

        // If our subscription went to zero references then `retain()` is called again,
        // we need to revive the subscription class.
        //
        // TODO(calebmer): If we are retaining again we should probably incorporate the
        // old data in our class back into the store? So we can show data while the
        // realtime client is re-subscribing.
        if (this._referenceCount === 1) {
            batchStoreUpdates(() => {
                // Add the subscription back to our store.
                const taskEntryStore =
                    this._store.onTaskSubscriptionRetainedAgainAfterFinalRelease(this);
                this._taskEntryStore.set(taskEntryStore);

                // Add back dependencies.
                this._trackTaskDependenciesFromAdd(taskEntryStore.getSnapshot());
            });
        }
    }

    /**
     * Release our reference to the subscription. Once the subscription hits zero
     * references we will clean up this subscription and all its data.
     */
    public release() {
        assert(this._referenceCount > 0, "Subscription is already released");

        this._referenceCount--;

        if (this._referenceCount === 0) {
            batchStoreUpdates(() => {
                // Remove dependencies.
                this._trackTaskDependenciesFromRemove(
                    this._taskEntryStore.getSnapshot().getSnapshot(),
                );

                // Should have been cleared by removing all our loaded tasks.
                assert(this._referencedTaskEntryStoreById.size === 0);
                assert(this._referencedCollectionEntryStoreById.size === 0);

                // Delete the subscription from our store.
                this._store.onTaskSubscriptionFinallyReleased(this);
            });
        }
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

    // This is a private function we expose publicly so `TaskClientStoreInternal`
    // can call it. To call you must prove you have access to a
    // `TaskClientStoreInternal` instance.
    //
    // We could also do a `TaskClientTaskSubscription`
    // `TaskClientTaskSubscriptionInternal` class split like we do for
    // `TaskClientQuery` but that feels like too much for one method.
    public _onTaskUpdate(
        internal: TaskClientStoreInternal,
        taskId: TaskId,
        oldTaskEntry: TaskClientStoreTaskEntry,
        newTaskEntry: TaskClientStoreTaskEntry,
    ) {
        assert(internal instanceof TaskClientStoreInternal);
        this._trackTaskDependenciesFromUpdate(oldTaskEntry, newTaskEntry);
    }
}
