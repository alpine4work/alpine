import createTree, {Tree} from "functional-red-black-tree";
import {Store} from "~/client/helpers/store/internal/store.js";
import {StoreWeakImmediateListeners} from "~/client/helpers/store/internal/store_weak_immediate_listeners.js";
import {InternalError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {symmetricDiffTree} from "~/shared/helpers/immutable/symmetric_diff_tree.js";

/**
 * A combinator for flattening `Store<Tree<Key, Store<Value>>>` stores into
 * `Store<Tree<Key, Value>>`. Well, that combinator would just be the `flat()`
 * operation. This combinator also supports `map()` which makes it the
 * `flatMap()` combinator. The original tree is `Store<Tree<Key, OldValue>>`
 * where `OldValue` may or may not be a `Store`. There's a map function from
 * `(value: OldValue) => Store<NewValue>`.
 *
 * We combine the `flat()` and `map()` combinators into one for trees so we
 * don't need to build an unnecessary intermediate tree when implementing
 * `flatMap()`. If you just need `flat()` it can be implemented from
 * `flatMap()` easily.
 */
export class FlattenedMappedTreeStore<Key, OldValue, NewValue> extends Store<Tree<Key, NewValue>> {
    private readonly _store: Store<Tree<Key, OldValue>>;
    private readonly _map: (value: OldValue, key: Key) => Store<NewValue>;
    private _isOldTreeInvalid = false;
    private _oldTree: Tree<Key, OldValue>;
    private _newTree: Tree<Key, NewValue>;

    private readonly _nestedStoreByKey = new Map<
        Key,
        {
            store: Store<NewValue>;
            // When a nested store is invalidated, when `getSnapshot()` is called we want
            // to only update the invalidated keys. So we attach an extra listener (this
            // function) that records what precisely was invalidated.
            readonly weakImmediateListener: () => void;
        }
    >();

    private _nestedStoreInvalidatedKeys: Set<Key> | null = null;

    private readonly _listeners = new Map<() => void, number>();
    private _weakImmediateListeners: StoreWeakImmediateListeners | null = null;

    constructor(
        store: Store<Tree<Key, OldValue>>,
        map: (value: OldValue, key: Key) => Store<NewValue>,
    ) {
        super();
        this._store = store;
        this._map = map;
        this._oldTree = this._store.getSnapshot();

        // Initialize the result tree here in the constructor. We need to add our
        // listeners to any stores to make sure they're updated properly.
        let newTree = createTree<Key, NewValue>(this._oldTree._compare);

        const iterator = this._oldTree.begin;
        while (iterator.valid) {
            const newNestedStore = this._map(iterator.value!, iterator.key!);

            const weakImmediateListener = this._createNestedWeakImmediateListener(iterator.key!);

            // 1. Add a weak immediate listener that will invalidate just this key when it
            //    changes so we don't need to update the entire map.
            newNestedStore._addWeakImmediateListener(weakImmediateListener);

            // 2. Propagate outside weak immediate listeners to our nested store.
            this._weakImmediateListeners?.moveListeners(null, newNestedStore);

            // 3. Propagate outside listeners to our nested store.
            for (const [listener, listenerCount] of this._listeners) {
                for (let i = 0; i < listenerCount; i++) {
                    newNestedStore.addListener(listener);
                }
            }

            // 4. Remember the nested store so we can move listeners around later.
            this._nestedStoreByKey.set(iterator.key!, {
                store: newNestedStore,
                weakImmediateListener,
            });

            // 5. Update our result tree.
            newTree = newTree.insert(iterator.key!, newNestedStore.getSnapshot());
            iterator.next();
        }

        this._newTree = newTree;
    }

    private _createNestedWeakImmediateListener(key: Key) {
        return () => {
            this._nestedStoreInvalidatedKeys ??= new Set();
            this._nestedStoreInvalidatedKeys.add(key);
        };
    }

    public readonly getSnapshot = () => {
        const oldOldTree = this._oldTree;
        const newOldTree = (this._oldTree = this._store.getSnapshot());

        if (oldOldTree !== newOldTree) {
            const changes = symmetricDiffTree(oldOldTree, newOldTree);
            for (const change of changes) {
                switch (change.type) {
                    case "CreateEntry": {
                        const newNestedStore = this._map(change.newValue, change.key);

                        const weakImmediateListener = this._createNestedWeakImmediateListener(
                            change.key,
                        );

                        // 1. Add a weak immediate listener that will invalidate just this key when it
                        //    changes so we don't need to update the entire map.
                        newNestedStore._addWeakImmediateListener(weakImmediateListener);

                        // 2. Propagate outside weak immediate listeners to our nested store.
                        this._weakImmediateListeners?.moveListeners(null, newNestedStore);

                        // 3. Propagate outside listeners to our nested store.
                        for (const [listener, listenerCount] of this._listeners) {
                            for (let i = 0; i < listenerCount; i++) {
                                newNestedStore.addListener(listener);
                            }
                        }

                        // 4. Remember the nested store so we can move listeners around later.
                        this._nestedStoreByKey.set(change.key, {
                            store: newNestedStore,
                            weakImmediateListener,
                        });

                        // 5. Record that this key needs to update next time `getSnapshot()` is called.
                        this._nestedStoreInvalidatedKeys ??= new Set();
                        this._nestedStoreInvalidatedKeys.add(change.key);
                        break;
                    }
                    case "DeleteEntry": {
                        const {store: oldNestedStore, weakImmediateListener} =
                            this._nestedStoreByKey.get(change.key)!;

                        // 1. Remove the weak immediate listener which is responsible for invalidating
                        //    just this key.
                        oldNestedStore._removeWeakImmediateListener(weakImmediateListener);

                        // 2. Remove propagated outside weak immediate listeners from our nested store.
                        this._weakImmediateListeners?.moveListeners(oldNestedStore, null);

                        // 3. Remove propagated outside listeners from our nested store.
                        for (const [listener, listenerCount] of this._listeners) {
                            for (let i = 0; i < listenerCount; i++) {
                                oldNestedStore.removeListener(listener);
                            }
                        }

                        // 4. Stop keeping track of this nested store.
                        this._nestedStoreByKey.delete(change.key);

                        // 5. Record that this key needs to update next time `getSnapshot()` is called.
                        this._nestedStoreInvalidatedKeys ??= new Set();
                        this._nestedStoreInvalidatedKeys.add(change.key);
                        break;
                    }
                    case "UpdateEntry": {
                        const nestedStoreEntry = this._nestedStoreByKey.get(change.key)!;
                        const {store: oldNestedStore, weakImmediateListener} = nestedStoreEntry;

                        const newNestedStore = this._map(change.newValue, change.key);

                        // If the nested store changed, move listeners from the old store to the
                        // new store.
                        if (oldNestedStore !== newNestedStore) {
                            // 1. Move the weak immediate listener that invalidates just the current key
                            //    when it changes.
                            oldNestedStore._removeWeakImmediateListener(weakImmediateListener);
                            newNestedStore._addWeakImmediateListener(weakImmediateListener);

                            // 2. Move propagated outside weak immediate listeners to the new store.
                            this._weakImmediateListeners?.moveListeners(
                                oldNestedStore,
                                newNestedStore,
                            );

                            // 3. Move propagated outside listeners to the new store.
                            for (const [listener, listenerCount] of this._listeners) {
                                for (let i = 0; i < listenerCount; i++) {
                                    oldNestedStore.removeListener(listener);
                                    newNestedStore.addListener(listener);
                                }
                            }

                            // 4. Remember the new nested store so we can move listeners around later.
                            nestedStoreEntry.store = newNestedStore;

                            // 5. Record that this key needs to update next time `getSnapshot()` is called.
                            this._nestedStoreInvalidatedKeys ??= new Set();
                            this._nestedStoreInvalidatedKeys.add(change.key);
                        }
                        break;
                    }
                    default:
                        throw exhaustive(change);
                }
            }
        }

        // We keep track of individual nested store keys that were invalidated so we
        // only need to update them instead of looking at every key in our map.
        if (this._nestedStoreInvalidatedKeys !== null) {
            let newTree = this._newTree;

            for (const key of this._nestedStoreInvalidatedKeys) {
                const nestedStoreEntry = this._nestedStoreByKey.get(key);

                if (nestedStoreEntry === undefined) {
                    newTree = newTree.remove(key);
                } else {
                    const newNestedValue = nestedStoreEntry.store.getSnapshot();

                    const iterator = newTree.find(key);

                    // Optimization: If the nested key was invalidated but the underlying value
                    // didn't actually change, don't update the tree.
                    if (iterator.valid && Object.is(iterator.value!, newNestedValue)) continue;

                    newTree = iterator.valid
                        ? iterator.update(newNestedValue)
                        : newTree.insert(key, newNestedValue);
                }
            }

            this._newTree = newTree;
            this._nestedStoreInvalidatedKeys = null;
        }

        return this._newTree;
    };

    public addListener(listener: () => void) {
        const listenerCount = (this._listeners.get(listener) ?? 0) + 1;
        this._listeners.set(listener, listenerCount);

        this._store.addListener(listener);

        for (const {store: nestedStore} of this._nestedStoreByKey.values()) {
            nestedStore.addListener(listener);
        }
    }

    public removeListener(listener: () => void) {
        const listenerCount = (this._listeners.get(listener) ?? 0) - 1;
        if (listenerCount < 0) {
            throw new InternalError("Can't remove listener that wasn't added to store");
        } else if (listenerCount === 0) {
            this._listeners.delete(listener);
        } else {
            this._listeners.set(listener, listenerCount);
        }

        this._store.removeListener(listener);

        for (const {store: nestedStore} of this._nestedStoreByKey.values()) {
            nestedStore.removeListener(listener);
        }
    }

    public _addWeakImmediateListener(listener: () => void): void {
        this._weakImmediateListeners ??= new StoreWeakImmediateListeners();
        this._weakImmediateListeners.addListener(listener);

        this._store._addWeakImmediateListener(listener);

        for (const {store: nestedStore} of this._nestedStoreByKey.values()) {
            nestedStore._addWeakImmediateListener(listener);
        }
    }

    public _removeWeakImmediateListener(listener: () => void): void {
        this._weakImmediateListeners ??= new StoreWeakImmediateListeners();
        this._weakImmediateListeners.removeListener(listener);

        this._store._removeWeakImmediateListener(listener);

        for (const {store: nestedStore} of this._nestedStoreByKey.values()) {
            nestedStore._removeWeakImmediateListener(listener);
        }
    }
}
