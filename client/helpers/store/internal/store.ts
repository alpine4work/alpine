// To defend against cyclic import issues we initialize these variables in
// their respective modules instead of importing them here.
let FlattenedStore: typeof import("~/client/helpers/store/internal/flattened_store.js").FlattenedStore;
let MappedStore: typeof import("~/client/helpers/store/internal/mapped_store.js").MappedStore;

export function setFlattenedStore(value: typeof FlattenedStore) {
    FlattenedStore = value;
}

export function setMappedStore(value: typeof MappedStore) {
    MappedStore = value;
}

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
     * Add a listener to this store.
     *
     * If you add the exact same listener multiple times then it will only be
     * called once. Listeners are called in the order they are added.
     *
     * `subscribe()` calls this function and has a more convenient syntax.
     */
    public abstract addListener(listener: () => void): void;

    /**
     * Remove a listener from this store.
     *
     * Will throw an error if you're trying to remove a listener that
     * doesn't exist.
     *
     * `subscribe()` calls this function and has a more convenient syntax.
     */
    public abstract removeListener(listener: () => void): void;

    /**
     * Private function that should only be called by store class implementations.
     *
     * Adds a weak immediate listener.
     *
     * Weak immediate listeners:
     *
     * 1. Run before regular listeners
     * 2. Are not deferred during a transaction
     * 3. Hold the `listener` function weakly
     *
     * They are used by store implementations to update their internal state after
     * an update such that a `getSnapshot()` call after an update presents the
     * right value. These listeners are weakly held to avoid creating a reference
     * cycle and allowing the store adding the listener to be garbage collected.
     */
    public abstract _addWeakImmediateListener(listener: () => void): void;

    /**
     * Private function that should only be called by store class implementations.
     *
     * Removes a weak immediate listener. See `_addWeakImmediateListener()` for
     * more information on the behavior of these listeners.
     */
    public abstract _removeWeakImmediateListener(listener: () => void): void;

    /**
     * Subscribe to whenever the store value updates. A listener will be called
     * with the new value.
     *
     * When the value updates the subscribe function is called synchronously.
     *
     * Calls `addListener()` and `removeListener()`. See the documentation on
     * `addListener()` for important information on the semantics of this function.
     */
    // NOTE: This is an arrow function so you can dereference the function like
    // `useSyncExternalStore(store.subscribe, store.getSnapshot)` without losing
    // the `this` reference.
    public readonly subscribe = (listener: () => void) => {
        this.addListener(listener);
        return () => {
            this.removeListener(listener);
        };
    };

    /**
     * Create a new store with the value of this store transformed with the
     * provided function.
     */
    public map<NewValue>(map: (value: Value) => NewValue): Store<NewValue> {
        return new MappedStore(this, map);
    }

    /**
     * If we have a nested store this function flattens a `Store<Store<Value>>`
     * into just `Store<Value>`.
     *
     * This name is derived from `Array.flat()`. It's used to implement
     * `Store.flatMap()`.
     */
    public flat<Value>(this: Store<Store<Value>>): Store<Value> {
        return new FlattenedStore(this);
    }

    /**
     * Map from one value to another but allow returning a `Store` from the map
     * function.
     *
     * The name is derived from `Array.flatMap()`.
     *
     * If you're a student of functional programming you may notice this makes
     * `Store` a monad! ([Read this article to learn about monads in the context of
     * Haskell][1].)
     *
     * In JavaScript, the `Promise` object is also a monad with its `then()`
     * function. We could also follow that convention and call this function
     * `Store.then()`. We chose the array convention (`Store.flatMap()`) since it
     * makes more sense in the presence of `Store.map()`.
     *
     * [1]: http://learnyouahaskell.com/a-fistful-of-monads
     */
    public flatMap<NewValue>(map: (value: Value) => Store<NewValue>): Store<NewValue> {
        return new FlattenedStore(new MappedStore(this, map));
    }
}
