import {
    TaskClientReadonlyStore,
    TaskClientStoreCollectionEntry,
    TaskClientStoreInternal,
} from "~/client/web/tasks/core/task_client_store.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

/**
 * Maintains a subscription to a single collection outside of a query. Useful
 * when we're looking at a collection view, for instance. We want to load the
 * collection for the collection view separately in case there are no tasks in
 * the collection's query.
 */
export class TaskClientCollectionSubscription {
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
    public readonly collectionId: TaskCollectionId;
    private readonly _collectionEntryStoreWithoutError: Store<TaskClientStoreCollectionEntry>;

    private readonly _errorStateStore = new ValueStore<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    /**
     * The collection associated with this subscription. The collection might be
     * `null` if our store hasn't seen it yet. `TaskRealtimeClient` is responsible
     * for subscribing to the task on the server.
     *
     * If the underlying subscription has an error then calling `getSnapshot()`
     * will throw the error.
     */
    public readonly collectionEntryStore: Store<TaskClientStoreCollectionEntry>;

    constructor(
        store: TaskClientStoreInternal,
        collectionId: TaskCollectionId,
        collectionEntryStore: Store<TaskClientStoreCollectionEntry>,
    ) {
        this._store = store;
        this.store = store.external;
        this.collectionId = collectionId;
        this._collectionEntryStoreWithoutError = collectionEntryStore;

        this.collectionEntryStore = Store.map(
            this._collectionEntryStoreWithoutError,
            this._errorStateStore,
            (collectionEntry, errorState) => {
                if (errorState.hasError) throw errorState.error;
                return collectionEntry;
            },
        );
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
            this._store.onCollectionSubscriptionFinallyReleased(this);
        }
    }

    /**
     * If there was an error in our `TaskRealtimeService` subscription for this
     * collection then this function is called to transition the collection to an
     * error state. The error will be re-thrown in UI components when trying to
     * access the collection's data.
     */
    public setError(error: unknown) {
        this._errorStateStore.set({hasError: true, error});
    }

    /**
     * If this collection is in an erred state because `setError()` was previously
     * called then this function clears the error and allows normal operation to
     * resume.
     */
    public clearError() {
        this._errorStateStore.set(errorState =>
            errorState.hasError ? {hasError: false} : errorState,
        );
    }
}
