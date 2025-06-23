import createTree, {Tree} from "functional-red-black-tree";
import {InternalError} from "~/shared/error/error.js";
import {captureResult} from "~/shared/helpers/control/capture_result.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Result} from "~/shared/helpers/control/result.js";
import {thenResult} from "~/shared/helpers/control/then_result.js";
import {symmetricDiffTree} from "~/shared/helpers/immutable/symmetric_diff_tree.js";
import {Store} from "~/shared/store/internal/store.js";
import {StoreWeakImmediateListeners} from "~/shared/store/internal/store_weak_immediate_listeners.js";

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
    private _oldTree: Tree<Key, OldValue> | null = null;
    private _newTree: {
        values: Tree<Key, NewValue>;
        errors: Tree<Key, unknown>;
    } | null = null;

    private readonly _nestedStoreByKey = new Map<
        Key,
        {
            storeResult: Result<Store<NewValue>>;
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
    }

    private _createNestedWeakImmediateListener(key: Key) {
        return () => {
            this._nestedStoreInvalidatedKeys ??= new Set();
            this._nestedStoreInvalidatedKeys.add(key);
        };
    }

    public override isFinal(): boolean {
        // This function should be fast. Recursively checking if all our stores are
        // final defeats the point of this optimization. So assume the store is not
        // final.
        return false;
    }

    public readonly getSnapshot = () => {
        // Initialize `newTree` if we haven't initialized it before.
        if (this._newTree === null) {
            // If `getSnapshot()` throws, it's fine. We don't leave our store in a bad
            // partial state.
            this._oldTree = this._store.getSnapshot();

            let newTreeValues = createTree<Key, NewValue>(this._oldTree._compare);
            let newTreeErrors = createTree<Key, unknown>(this._oldTree._compare);

            const iterator = this._oldTree.begin;
            while (iterator.valid) {
                const newNestedStoreResult = captureResult(() =>
                    this._map(iterator.value!, iterator.key!),
                );

                const weakImmediateListener = this._createNestedWeakImmediateListener(
                    iterator.key!,
                );

                // 1. Add a weak immediate listener that will invalidate just this key when it
                //    changes so we don't need to update the entire map.
                newNestedStoreResult.value?._addWeakImmediateListener(weakImmediateListener);

                // 2. Propagate outside weak immediate listeners to our nested store.
                this._weakImmediateListeners?.moveListeners(
                    null,
                    newNestedStoreResult.value ?? null,
                );

                // 3. Propagate outside listeners to our nested store.
                for (const [listener, listenerCount] of this._listeners) {
                    for (let i = 0; i < listenerCount; i++) {
                        newNestedStoreResult.value?.addListener(listener);
                    }
                }

                // 4. Remember the nested store so we can move listeners around later.
                this._nestedStoreByKey.set(iterator.key!, {
                    storeResult: newNestedStoreResult,
                    weakImmediateListener,
                });

                // 5. Update our result tree.
                const result = thenResult(newNestedStoreResult, newNestedStore =>
                    newNestedStore.getSnapshot(),
                );
                if (result.ok) {
                    newTreeValues = newTreeValues.insert(iterator.key!, result.value);
                } else {
                    newTreeErrors = newTreeErrors.insert(iterator.key!, result.error);
                }
                iterator.next();
            }

            this._newTree = {
                values: newTreeValues,
                errors: newTreeErrors,
            };

            // If there are any errors in our tree then throw the first error instead of
            // returning a partially correct tree.
            if (this._newTree.errors.length > 0) {
                throw this._newTree.errors.begin.value;
            }

            return this._newTree.values;
        }

        const oldOldTree = this._oldTree!;
        // If `getSnapshot()` throws, it's fine. We don't leave our store in a bad
        // partial state.
        const newOldTree = (this._oldTree = this._store.getSnapshot());

        if (oldOldTree !== newOldTree) {
            const changes = symmetricDiffTree(oldOldTree, newOldTree);
            for (const change of changes) {
                switch (change.type) {
                    case "CreateEntry": {
                        const newNestedStoreResult = captureResult(() =>
                            this._map(change.newValue, change.key),
                        );

                        const weakImmediateListener = this._createNestedWeakImmediateListener(
                            change.key,
                        );

                        // 1. Add a weak immediate listener that will invalidate just this key when it
                        //    changes so we don't need to update the entire map.
                        newNestedStoreResult.value?._addWeakImmediateListener(
                            weakImmediateListener,
                        );

                        // 2. Propagate outside weak immediate listeners to our nested store.
                        this._weakImmediateListeners?.moveListeners(
                            null,
                            newNestedStoreResult.value ?? null,
                        );

                        // 3. Propagate outside listeners to our nested store.
                        for (const [listener, listenerCount] of this._listeners) {
                            for (let i = 0; i < listenerCount; i++) {
                                newNestedStoreResult.value?.addListener(listener);
                            }
                        }

                        // 4. Remember the nested store so we can move listeners around later.
                        this._nestedStoreByKey.set(change.key, {
                            storeResult: newNestedStoreResult,
                            weakImmediateListener,
                        });

                        // 5. Record that this key needs to update next time `getSnapshot()` is called.
                        this._nestedStoreInvalidatedKeys ??= new Set();
                        this._nestedStoreInvalidatedKeys.add(change.key);
                        break;
                    }
                    case "DeleteEntry": {
                        const {storeResult: oldNestedStoreResult, weakImmediateListener} =
                            this._nestedStoreByKey.get(change.key)!;

                        // 1. Remove the weak immediate listener which is responsible for invalidating
                        //    just this key.
                        oldNestedStoreResult.value?._removeWeakImmediateListener(
                            weakImmediateListener,
                        );

                        // 2. Remove propagated outside weak immediate listeners from our nested store.
                        this._weakImmediateListeners?.moveListeners(
                            oldNestedStoreResult.value ?? null,
                            null,
                        );

                        // 3. Remove propagated outside listeners from our nested store.
                        for (const [listener, listenerCount] of this._listeners) {
                            for (let i = 0; i < listenerCount; i++) {
                                oldNestedStoreResult.value?.removeListener(listener);
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
                        const {storeResult: oldNestedStoreResult, weakImmediateListener} =
                            nestedStoreEntry;

                        const newNestedStoreResult = captureResult(() =>
                            this._map(change.newValue, change.key),
                        );

                        // If the nested store changed, move listeners from the old store to the
                        // new store.
                        if (oldNestedStoreResult.value !== newNestedStoreResult.value) {
                            // 1. Move the weak immediate listener that invalidates just the current key
                            //    when it changes.
                            oldNestedStoreResult.value?._removeWeakImmediateListener(
                                weakImmediateListener,
                            );
                            newNestedStoreResult.value?._addWeakImmediateListener(
                                weakImmediateListener,
                            );

                            // 2. Move propagated outside weak immediate listeners to the new store.
                            this._weakImmediateListeners?.moveListeners(
                                oldNestedStoreResult.value ?? null,
                                newNestedStoreResult.value ?? null,
                            );

                            // 3. Move propagated outside listeners to the new store.
                            for (const [listener, listenerCount] of this._listeners) {
                                for (let i = 0; i < listenerCount; i++) {
                                    oldNestedStoreResult.value?.removeListener(listener);
                                    newNestedStoreResult.value?.addListener(listener);
                                }
                            }

                            // 4. Remember the new nested store so we can move listeners around later.
                            nestedStoreEntry.storeResult = newNestedStoreResult;

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
            let newTreeValues = this._newTree.values;
            let newTreeErrors = this._newTree.errors;

            for (const key of this._nestedStoreInvalidatedKeys) {
                const nestedStoreEntry = this._nestedStoreByKey.get(key);

                if (nestedStoreEntry === undefined) {
                    newTreeValues = newTreeValues.remove(key);
                    newTreeErrors = newTreeErrors.remove(key);
                } else {
                    const result = thenResult(nestedStoreEntry.storeResult, nestedStore =>
                        nestedStore.getSnapshot(),
                    );

                    const newTreeValuesIterator = newTreeValues.find(key);
                    const newTreeErrorsIterator = newTreeErrors.find(key);

                    // Optimization: If the nested key was invalidated but the underlying value
                    // didn't actually change, don't update the tree.
                    if (
                        newTreeValuesIterator.valid &&
                        result.ok &&
                        Object.is(newTreeValuesIterator.value!, result.value)
                    ) {
                        continue;
                    }

                    // Optimization: If the nested key was invalidated but the underlying value
                    // didn't actually change, don't update the tree.
                    if (
                        newTreeErrorsIterator.valid &&
                        !result.ok &&
                        Object.is(newTreeErrorsIterator.value, result.error)
                    ) {
                        continue;
                    }

                    if (result.ok) {
                        newTreeValues = newTreeValuesIterator.valid
                            ? newTreeValuesIterator.update(result.value)
                            : newTreeValues.insert(key, result.value);

                        if (newTreeErrorsIterator.valid) {
                            newTreeErrors = newTreeErrorsIterator.remove();
                        }
                    } else {
                        newTreeErrors = newTreeErrorsIterator.valid
                            ? newTreeErrorsIterator.update(result.error)
                            : newTreeErrors.insert(key, result.error);

                        if (newTreeValuesIterator.valid) {
                            newTreeValues = newTreeValuesIterator.remove();
                        }
                    }
                }
            }

            this._newTree = {
                values: newTreeValues,
                errors: newTreeErrors,
            };
            this._nestedStoreInvalidatedKeys = null;
        }

        // If there are any errors in our tree then throw the first error instead of
        // returning a partially correct tree.
        if (this._newTree.errors.length > 0) {
            throw this._newTree.errors.begin.value;
        }

        return this._newTree.values;
    };

    public addListener(listener: () => void) {
        const listenerCount = (this._listeners.get(listener) ?? 0) + 1;
        this._listeners.set(listener, listenerCount);

        this._store.addListener(listener);

        for (const {storeResult: nestedStoreResult} of this._nestedStoreByKey.values()) {
            nestedStoreResult.value?.addListener(listener);
        }
    }

    public removeListener(listener: () => void) {
        const listenerCount = (this._listeners.get(listener) ?? 0) - 1;
        if (listenerCount < 0) {
            throw new InternalError("Can’t remove listener that wasn’t added to store");
        } else if (listenerCount === 0) {
            this._listeners.delete(listener);
        } else {
            this._listeners.set(listener, listenerCount);
        }

        this._store.removeListener(listener);

        for (const {storeResult: nestedStoreResult} of this._nestedStoreByKey.values()) {
            nestedStoreResult.value?.removeListener(listener);
        }
    }

    public _addWeakImmediateListener(listener: () => void): void {
        this._weakImmediateListeners ??= new StoreWeakImmediateListeners();
        this._weakImmediateListeners.addListener(listener);

        this._store._addWeakImmediateListener(listener);

        for (const {storeResult: nestedStoreResult} of this._nestedStoreByKey.values()) {
            nestedStoreResult.value?._addWeakImmediateListener(listener);
        }
    }

    public _removeWeakImmediateListener(listener: () => void): void {
        this._weakImmediateListeners ??= new StoreWeakImmediateListeners();
        this._weakImmediateListeners.removeListener(listener);

        this._store._removeWeakImmediateListener(listener);

        for (const {storeResult: nestedStoreResult} of this._nestedStoreByKey.values()) {
            nestedStoreResult.value?._removeWeakImmediateListener(listener);
        }
    }
}
