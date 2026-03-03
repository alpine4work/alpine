import createTree, {Tree} from "functional-red-black-tree";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TreeChange} from "~/shared/helpers/immutable/symmetric_diff_tree.js";
import {FlattenedMappedTreeStore} from "~/shared/store/internal/flattened_mapped_tree_store.js";
import {ReducedTreeStore} from "~/shared/store/internal/reduced_tree_store.js";
import {Store} from "~/shared/store/store.js";

/**
 * Reduces a `Store<Tree<Key, Value>>` into some value efficiently. Since instead
 * of rerunning the reducer on the full tree whenever the tree changes (which would
 * mean updates are O(n)) we reduce diffs to the tree over time (which means
 * updates are O(1)).
 */
export function reduceTreeStore<TreeKey, TreeValue, Value>(
    store: Store<Tree<TreeKey, TreeValue>>,
    reduce: (value: Value, change: TreeChange<TreeKey, TreeValue>) => Value,
    initialValue: Value,
): Store<Value> {
    return new ReducedTreeStore(store, reduce, initialValue);
}

/**
 * Maps the values of a tree from `OldValue` to `NewValue` efficiently. Only
 * re-maps tree values when the underlying value changes.
 */
export function mapTreeStoreValues<Key, OldValue, NewValue>(
    store: Store<Tree<Key, OldValue>>,
    map: (value: OldValue, key: Key) => NewValue,
): Store<Tree<Key, NewValue>> {
    return new ReducedTreeStore<Key, OldValue, Tree<Key, NewValue>>(
        store,
        (tree, change) => {
            switch (change.type) {
                case "CreateEntry": {
                    return tree.insert(change.key, map(change.newValue, change.key));
                }
                case "UpdateEntry": {
                    const iterator = tree.find(change.key);
                    const newValue = map(change.newValue, change.key);

                    // Optimization: If the mapped value didn't change then we don't need to update the
                    // tree.
                    if (Object.is(iterator.value!, newValue)) return tree;

                    return iterator.update(newValue);
                }
                case "DeleteEntry": {
                    return tree.remove(change.key);
                }
                default:
                    throw exhaustive(change);
            }
        },
        createTree<Key, NewValue>(store.getSnapshot()._compare),
    );
}

/**
 * Flattens a `Store<Tree<Key, Store<Value>>>` to `Store<Tree<Key, Value>>`. That
 * way your root store gets all updates and you can operate on the flattened tree
 * as a whole.
 */
export function flatTreeStoreValues<Key, Value>(
    store: Store<Tree<Key, Store<Value>>>,
): Store<Tree<Key, Value>> {
    return new FlattenedMappedTreeStore(store, cast);
}

/**
 * Both maps (`mapTreeStoreValues()`) and flattens (`flatTreeStoreValues()`) a
 * tree. This function is more efficient then calling the map and flat combinators
 * independently since we don't build an intermediate tree object.
 */
export function flatMapTreeStoreValues<Key, OldValue, NewValue>(
    store: Store<Tree<Key, OldValue>>,
    map: (value: OldValue, key: Key) => Store<NewValue>,
): Store<Tree<Key, NewValue>> {
    return new FlattenedMappedTreeStore(store, map);
}
