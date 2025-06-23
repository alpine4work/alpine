import {InternalError} from "~/shared/error/error.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {storeUpdatesBatch} from "~/shared/store/batch_store_updates.js";
import {StoreWeakImmediateListeners} from "~/shared/store/internal/store_weak_immediate_listeners.js";
import {Store} from "~/shared/store/store.js";

/**
 * A simple immutable value store object designed for use with React's
 * [`useSyncExternalStore()`][1] hook.
 *
 * Store values are immutable. You should only change the value in the store
 * by calling `set()`.
 *
 * [1]: https://react.dev/reference/react/useSyncExternalStore
 */
export class ValueStore<Value> extends Store<Value> {
    private _isFinal = false;
    private _value: Value;
    private readonly _listeners = new Map<() => void, number>();
    private _weakImmediateListeners: StoreWeakImmediateListeners | null = null;

    constructor(value: Value) {
        super();
        this._value = value;
    }

    public override isFinal(): boolean {
        return this._isFinal;
    }

    /**
     * Get the current value of the store. If you call this function you won't be
     * subscribed to updates from the store! Generally you want to use this
     * alongside `subscribe()`.
     *
     * We name this function `getSnapshot()` instead of the cleaner `get()` to
     * force the user to account for only getting the current value and not future
     * values. This name also aligns with the `useSyncExternalStore()` API.
     */
    // NOTE: This is an arrow function so you can dereference the function like
    // `useSyncExternalStore(store.subscribe, store.getSnapshot)` without losing
    // the `this` reference.
    public readonly getSnapshot = (): Value => {
        return this._value;
    };

    /**
     * Update the value in the store. Calls any subscribed listeners. The store
     * value should be immutable so this should be the only way to update it.
     *
     * Immediately updates the store so if you call `getSnapshot()` on this store
     * or any dependent stores you can observe the new value.
     *
     * Listeners will be called synchronously unless we are in a
     * `batchStoreUpdates()` call. Then listeners are called at the end of
     * `batchStoreUpdates()`.
     */
    public set(value: Value | ((value: Value) => Value)): void {
        assert(!this._isFinal);

        const actualValue: Value =
            typeof value === "function" ? (value as (value: Value) => Value)(this._value) : value;

        // Optimization: Skip updates where the value is exactly equal to the
        // previous value.
        if (Object.is(this._value, actualValue)) return;

        this._value = actualValue;

        // Call immediate listeners before our regular listeners. Immediate listeners
        // update the internal state of any stores that depend on us.
        this._weakImmediateListeners?.callListeners();

        for (const listener of this._listeners.keys()) {
            // If we're in a transaction, defer calling listeners until the end of the
            // transaction.
            if (storeUpdatesBatch !== null) {
                storeUpdatesBatch.listeners.add(listener);
            } else {
                try {
                    listener();
                } catch (error) {
                    // If one of our listeners throws an error, continue calling the rest of our
                    // listeners.
                    //
                    // Treat listener errors as unhandled errors. Emitting an event should not need
                    // to think about downstream listener implementation details.
                    scheduleUncaughtError(error);
                }
            }
        }
    }

    /**
     * Performs a set on `ValueStore` and finalizes the store. You may not call `set()`
     * ever again on a finalized store! The tradeoff is some optimizations will kick in
     * for finalized stores.
     *
     * Useful if your `ValueStore` is tracking something like a promise which will
     * update once then never again.
     *
     * If we're executing in a `batchStoreUpdates()` then we ignore the batch and call
     * listeners immediately when this method is called. Since `isFinal()` guarantees
     * that listeners will never be called after `isFinal()` is set to true.
     */
    public finalSet(value: Value | ((value: Value) => Value)) {
        assert(!this._isFinal);

        const actualValue: Value =
            typeof value === "function" ? (value as (value: Value) => Value)(this._value) : value;

        if (!Object.is(this._value, actualValue)) {
            this._value = actualValue;

            // Call immediate listeners before our regular listeners. Immediate listeners
            // update the internal state of any stores that depend on us.
            this._weakImmediateListeners?.callListeners();

            for (const listener of this._listeners.keys()) {
                // If we're in a transaction, we must call our listeners immediately for the
                // final set. Delete our listener from the batch if it was present.
                if (storeUpdatesBatch !== null) {
                    storeUpdatesBatch.listeners.delete(listener);
                }

                try {
                    listener();
                } catch (error) {
                    // If one of our listeners throws an error, continue calling the rest of our
                    // listeners.
                    //
                    // Treat listener errors as unhandled errors. Emitting an event should not need
                    // to think about downstream listener implementation details.
                    scheduleUncaughtError(error);
                }
            }
        }

        this._isFinal = true;

        // Clear out our listeners. Now that our store is finalized we'll never call
        // listeners again.
        this._listeners.clear();
        this._weakImmediateListeners = null;
    }

    public addListener(listener: () => void) {
        if (this._isFinal) return;

        const listenerCount = (this._listeners.get(listener) ?? 0) + 1;
        this._listeners.set(listener, listenerCount);
    }

    public removeListener(listener: () => void) {
        if (this._isFinal) return;

        const listenerCount = (this._listeners.get(listener) ?? 0) - 1;
        if (listenerCount < 0) {
            throw new InternalError("Can’t remove listener that wasn’t added to store");
        } else if (listenerCount === 0) {
            this._listeners.delete(listener);
        } else {
            this._listeners.set(listener, listenerCount);
        }
    }

    public _addWeakImmediateListener(listener: () => void): void {
        if (this._isFinal) return;

        this._weakImmediateListeners ??= new StoreWeakImmediateListeners();
        this._weakImmediateListeners.addListener(listener);
    }

    public _removeWeakImmediateListener(listener: () => void): void {
        if (this._isFinal) return;

        this._weakImmediateListeners ??= new StoreWeakImmediateListeners();
        this._weakImmediateListeners.removeListener(listener);
    }

    public _getWeakImmediateListenerCountForTest() {
        assert(import.meta.jest);
        return this._weakImmediateListeners?.getListenerCountForTest() ?? 0;
    }
}
