import {MappedStore} from "~/client/helpers/store/mapped_store";

/**
 * A simple immutable value store object designed for use with React's
 * [`useSyncExternalStore()`][1] hook.
 *
 * Store values are immutable. That way you can observe all changes
 * with `subscribe`.
 *
 * [1]: https://react.dev/reference/react/useSyncExternalStore
 */
export abstract class Store<Value> {
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
    public abstract readonly getSnapshot: () => Value;

    /**
     * Subscribe to whenever the store value updates. A listener will be called
     * with the new value.
     *
     * When the value updates the subscribe function is called synchronously.
     */
    // NOTE: This is an arrow function so you can dereference the function like
    // `useSyncExternalStore(store.subscribe, store.getSnapshot)` without losing
    // the `this` reference.
    public abstract readonly subscribe: (listener: () => void) => () => void;

    /**
     * Create a new store with the value of this store transformed with the
     * provided function.
     */
    public map<NewValue>(map: (value: Value) => NewValue): Store<NewValue> {
        return new MappedStore(this, map);
    }
}
