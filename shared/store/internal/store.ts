import {cast} from "~/shared/helpers/control/cast.js";

// To defend against cyclic import issues we initialize these variables in
// their respective modules instead of importing them here.
let FlattenedMappedStore: typeof import("~/shared/store/internal/flattened_mapped_store.js").FlattenedMappedStore;
let MappedStore: typeof import("~/shared/store/internal/mapped_store.js").MappedStore;
let MappedManyStore: typeof import("~/shared/store/internal/mapped_many_store.js").MappedManyStore;
let ReducedStore: typeof import("~/shared/store/internal/reduced_store.js").ReducedStore;

export function setFlattenedMappedStore(value: typeof FlattenedMappedStore) {
    FlattenedMappedStore = value;
}

export function setMappedStore(value: typeof MappedStore) {
    MappedStore = value;
}

export function setMappedManyStore(value: typeof MappedManyStore) {
    MappedManyStore = value;
}

export function setReducedStore(value: typeof ReducedStore) {
    ReducedStore = value;
}

type StoreType<T extends Store<any>> = T extends Store<infer U> ? U : never;

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
     * Has the store been finalized? A final store will never update again. The
     * value returned by `getSnapshot()` will never change and any listeners added
     * by `addListener()` will not be called.
     *
     * Used as a performance optimization. You don't need to add listeners to
     * finalized stores.
     *
     * The implementation of this function should be O(1). It defeats the point of
     * the optimization if this function is slow. As such results are provided on a
     * best effort basis. There may be a store with only finalized dependencies
     * that itself is not `isFinal()` because checking whether it's final would be
     * too expensive.
     */
    public abstract isFinal(): boolean;

    /**
     * Get the current value of the store. If you call this function you won't be
     * subscribed to updates from the store! Generally you want to use this
     * alongside `subscribe()`.
     *
     * We name this function `getSnapshot()` instead of the cleaner `get()` to
     * force the user to account for only getting the current value and not future
     * values. This name also aligns with the `useSyncExternalStore()` API.
     *
     * ### Error handling
     *
     * This function may throw an error. If you're using a combinator like
     * `store.map(mapper)` and your `mapper` function throws an error then that
     * error is re-thrown when `getSnapshot()` is called.
     *
     * This error will be "memorized" just like any other computation and will
     * be thrown whenever you call `getSnapshot()` until the underlying store
     * changes. Store implementations generally behave this way, errors are caught
     * so the store's internal state isn't corrupted, then the error is re-thrown.
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
     *
     * After a listener is called and before you call `getSnapshot()` you may get
     * false positive or false negative calls to your listener. False positive
     * calls means `listener` is called when the underlying value didn't actually
     * update and false negative calls mean `listener` is NOT called when the
     * underlying value changed. If the stores you need to listen to change as a
     * result of an update, that doesn't happen until `getSnapshot()` is called
     * which will generally stabilize your store graph. If you need to accurately
     * determine when updates to your store happen then make sure to call
     * `getSnapshot()` in a timely manner.
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
     *
     * Avoid calling user functions in weak immediate listeners. If a store is made
     * garbage but is still calling its map function that's confusing for
     * developers (since they thought the store was dead code) and may lead to
     * broken results if the developer explicitly destroyed some resource used by
     * a store.
     *
     * Weak immediate listeners are useful for invalidating parts of a large data
     * structure so when `getSnapshot()` is called you only need to update those
     * parts instead of the whole tree.
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
     * Create a new store with the value of the provided stores transformed with
     * the provided function. `Store.map(store, value => { ... })` is the same as
     * `store.map(value => { ... })` but this form has the ability for you to map
     * multiple stores at once whereas the class method form does not.
     */
    public static map<const Stores extends ReadonlyArray<Store<any>>, NewValue>(
        ...args: [
            ...Stores,
            (
                ...values: {
                    [K in keyof Stores]: StoreType<Stores[K]>;
                } & ReadonlyArray<unknown>
            ) => NewValue,
        ]
    ): Store<NewValue> {
        const map = args[args.length - 1] as any;
        return new MappedManyStore(args.slice(0, args.length - 1) as any, values => map(...values));
    }

    /**
     * Create a new store with the value of the provided store array transformed
     * with the provided function.
     *
     * Same as the static `Store.map()` method but you can pass in an array of
     * dynamic length instead of a static number of store arguments.
     */
    public static mapMany<const Stores extends ReadonlyArray<Store<any>>, NewValue>(
        stores: Stores,
        map: (values: {
            readonly [K in keyof Stores]: StoreType<Stores[K]>;
        }) => NewValue,
    ): Store<NewValue> {
        return new MappedManyStore(stores, map);
    }

    /**
     * Takes an array of stores and creates a single `Store` with all of their
     * values unwrapped.
     *
     * Same as `Store.mapMany()` with the identity function as the map function.
     */
    // TODO(calebmer): We could implement an optimized store class that if a single
    // store invalidates we only need to call `getSnapshot()` on that store.
    // Instead of calling `getSnapshot()` on every store. Like what we do in
    // `FlattenedMappedTreeStore`. We add weak invalidation listeners to each value
    // store so we only need to update that key when it changes.
    public static many<const Stores extends ReadonlyArray<Store<any>>>(
        stores: Stores,
    ): Store<{
        readonly [K in keyof Stores]: StoreType<Stores[K]>;
    }> {
        return new MappedManyStore(stores, cast) as any;
    }

    /**
     * If we have a nested store this function flattens a `Store<Store<Value>>`
     * into just `Store<Value>`.
     *
     * This name is derived from `Array.flat()`. It's used to implement
     * `Store.flatMap()`.
     */
    public flat<Value>(this: Store<Store<Value>>): Store<Value> {
        // Optimization: Final stores don't update so we can directly use the store's
        // current value.
        if (this.isFinal()) return this.getSnapshot();

        return new FlattenedMappedStore(this, cast);
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
        // Optimization: Final stores don't update so we can directly use the store's
        // current value.
        if (this.isFinal()) return map(this.getSnapshot());

        return new FlattenedMappedStore(this, map);
    }

    /**
     * A reduce combinator that lets you observe the previous store value when
     * computing the next store value. It's similar conceptually to
     * `Array.reduce()` and has a similar signature but instead of reducing an
     * array of values we're reducing a store's values over time.
     *
     * The reduce function doesn't reliably observe every value from the base
     * store! Like other stores we compute `getSnapshot()` lazily. So the reduce
     * function only observes values from the base store when `getSnapshot()` is
     * called. If whatever pulls values from our stores (e.g. `useStore()` hook)
     * calls `getSnapshot()` whenever a changes is reported by a `subscribe()`
     * listener the reduce function will end up seeing every base store value over
     * time while the component is `subscribe()`d. If `getSnapshot()` is called
     * less frequently the reduce function might not see every base store value.
     */
    public reduce<NewValue, InitialValue>(
        reduce: (previousValue: NewValue | InitialValue, currentValue: Value) => NewValue,
        initialValue: InitialValue,
    ): Store<NewValue> {
        return new ReducedStore(this, reduce, initialValue);
    }
}
