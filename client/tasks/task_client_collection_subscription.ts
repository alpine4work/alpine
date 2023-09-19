import {Store} from "~/client/helpers/store/store.js";
import {
    TaskClientStoreCollectionEntry,
    TaskClientStoreInternal,
} from "~/client/tasks/task_client_store.js";
import {TaskClientTaskReferencesSubscriptionBase} from "~/client/tasks/task_client_task_references_subscription_base.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";

/**
 * Maintains a subscription to a single collection outside of a query. Useful
 * when we're looking at a collection view, for instance. We want to load the
 * collection for the collection view separately in case there are no tasks in
 * the collection's query.
 */
export class TaskClientCollectionSubscription extends TaskClientTaskReferencesSubscriptionBase {
    private readonly _store: TaskClientStoreInternal;
    public readonly collectionId: TaskCollectionId;

    // It's important we keep a reference to the collection entry store so it's not
    // garbage collected from our `TaskClientStore`.
    public readonly collectionEntryStore: Store<TaskClientStoreCollectionEntry>;

    constructor(
        store: TaskClientStoreInternal,
        collectionId: TaskCollectionId,
        collectionEntryStore: Store<TaskClientStoreCollectionEntry>,
    ) {
        super();
        this._store = store;
        this.collectionId = collectionId;
        this.collectionEntryStore = collectionEntryStore;
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
            this._store.onCollectionSubscriptionFinallyReleased(this);
        }
    }
}
