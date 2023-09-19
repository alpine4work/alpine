import {Store} from "~/client/helpers/store/store.js";
import {
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
    private readonly _store: TaskClientStoreInternal;
    public readonly taskId: TaskId;

    // It's important we keep a reference to the task entry store so it's not
    // garbage collected from our `TaskClientStore`.
    public readonly taskEntryStore: Store<TaskClientStoreTaskEntry>;

    constructor(
        store: TaskClientStoreInternal,
        taskId: TaskId,
        taskEntryStore: Store<TaskClientStoreTaskEntry>,
    ) {
        super();
        this._store = store;
        this.taskId = taskId;
        this.taskEntryStore = taskEntryStore;
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
        assert(this._referenceCount > 0, "Can't retain a released subscription");

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
}
