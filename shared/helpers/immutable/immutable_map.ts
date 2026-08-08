import createTree, {Tree} from "functional-red-black-tree";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {TreeChange, symmetricDiffTree} from "~/shared/helpers/immutable/symmetric_diff_tree.js";

// A bunch of methods have been added to `ReadonlyMap` iterator methods like
// `ReadonlyMap.values()` after upgrading to TypeScript 5.9.2 like `take()` and
// `drop()`. It would be nice to implement these on `ImmutableMap` someday but for
// now adhere to this more limited `ReadonlyMap` interface.
//
// TODO(calebmer, #typescript-5.9.2): Switch back to `implements ReadonlyMap<K, V>`
// instead of `implements OldReadonlyMap<K, V>`.
interface OldReadonlyMap<K, V> {
    forEach(callbackfn: (value: V, key: K, map: OldReadonlyMap<K, V>) => void, thisArg?: any): void;
    get(key: K): V | undefined;
    has(key: K): boolean;
    readonly size: number;
    [Symbol.iterator](): IterableIterator<[K, V]>;
    entries(): IterableIterator<[K, V]>;
    keys(): IterableIterator<K>;
    values(): IterableIterator<V>;
}

assertAssignableTypes<ReadonlyMap<unknown, unknown>, OldReadonlyMap<unknown, unknown>>();

/**
 * A [persistent data structure][1] containing entries of key-value pairs. Each key
 * is associated with exactly one value. Aims for compatibility with the `Map` API.
 *
 * The performance of `get()` and `set()` in `ImmutableMap` is O(log(n)) while the
 * performance of `get()` and `set()` in `Map` is O(1). So most of the time `Map`
 * is faster! If you're using `Map` in an immutable context you can call
 * `new Map(oldMap)` to clone a map then call `set()` which is O(n).
 *
 * So `ImmutableMap` is faster if you need an immutable data structure and the
 * number of `get()`s and `set()`s is balanced. If you rarely `set()` and
 * frequently `get()` consider using a `Map` that you clone on `set()` instead.
 *
 * We don't use [Immutable.js][2] since that library is large and bloated.
 *
 * This map is backed by a [red-black tree][3] data structure.
 *
 * [1]: https://en.wikipedia.org/wiki/Persistent_data_structure
 * [2]: https://immutable-js.com/
 * [3]: https://en.wikipedia.org/wiki/Red%E2%80%93black_tree
 */
export class ImmutableMap<Key extends string | number, Value> implements OldReadonlyMap<
    Key,
    Value
> {
    private readonly _tree: Tree<Key, Value>;

    private constructor(tree: Tree<Key, Value>) {
        this._tree = tree;
    }

    private static readonly _empty = new ImmutableMap(createTree<any, any>());

    /**
     * Creates a new empty map.
     *
     * A function so that you can provide new type parameters.
     *
     * All empty maps will be referentially equal to one another. So
     * `ImmutableMap.empty() === ImmutableMap.empty()`.
     */
    public static empty<Key extends string | number, Value>(): ImmutableMap<Key, Value> {
        return this._empty;
    }

    /**
     * Creates a new `ImmutableMap` from an entries iterable.
     *
     * You could use this to construct an `ImmutableMap` from a mutable `Map`.
     *
     * Completes in O(n \* log(n)) time.
     */
    public static from<Key extends string | number, Value>(
        entries: Iterable<[Key, Value]>,
    ): ImmutableMap<Key, Value> {
        let map = ImmutableMap.empty<Key, Value>();

        for (const [key, value] of entries) {
            map = map.set(key, value);
        }

        return map;
    }

    /**
     * Returns the number of key/value pairs in the map.
     */
    public get size(): number {
        return this._tree.length;
    }

    /**
     * Returns the value associated to the passed key, or `undefined` if there is none.
     *
     * Completes in O(log(n)) time.
     */
    public get(key: Key): Value | undefined {
        return this._tree.get(key);
    }

    /**
     * Returns a boolean indicating whether a value has been associated with the passed
     * key in the map or not.
     *
     * Completes in O(log(n)) time.
     */
    public has(key: Key): boolean {
        return !!this._tree.get(key);
    }

    /**
     * Returns a new map with the entry associated with the passed key updated to the
     * new value. The old map is unchanged.
     *
     * Completes in O(log(n)) time.
     *
     * If the new value is equal to the old value then we will return the immutable map
     * as-is as an optimization.
     */
    public set(key: Key, value: Value): ImmutableMap<Key, Value> {
        const node = this._tree.find(key);
        if (node.valid) {
            // Optimization: If the new value is equal to the old value, return the existing
            // immutable map without updating.
            if (Object.is(node.value, value)) return this;

            return new ImmutableMap(node.update(value));
        } else {
            return new ImmutableMap(this._tree.insert(key, value));
        }
    }

    /**
     * Updates a value in the map. Slightly more efficient than calling `get()` and
     * `set()` separately.
     *
     * If there is no value for this key then your update function will get
     * `undefined`. If you want to remove the entry from the map then return
     * `undefined` from your update function.
     *
     * Completes in O(log(n)) time.
     *
     * If the new value is equal to the old value then we will return the immutable map
     * as-is as an optimization.
     */
    public update(
        key: Key,
        update: (value: Value | undefined) => Value | undefined,
    ): ImmutableMap<Key, Value> {
        const node = this._tree.find(key);
        if (node.valid) {
            const newValue = update(node.value);

            if (newValue === undefined) return new ImmutableMap(node.remove());

            // Optimization: If the new value is equal to the old value, return the existing
            // immutable map without updating.
            if (Object.is(node.value, newValue)) return this;

            return new ImmutableMap(node.update(newValue));
        } else {
            const newValue = update(undefined);
            if (newValue === undefined) return this;
            return new ImmutableMap(this._tree.insert(key, newValue));
        }
    }

    /**
     * Update every value in the immutable map. If the update function returns
     * `undefined` then the entry is removed from the map.
     *
     * Completes in O(log(n)) time.
     *
     * If every new value is equal to the corresponding old value then we will return
     * the immutable map as-is as an optimization.
     */
    public updateEvery(
        update: (value: Value, key: Key) => Value | undefined,
    ): ImmutableMap<Key, Value> {
        let tree = this._tree;
        let iterator = this._tree.begin;

        while (iterator.valid) {
            const key = iterator.key!;
            const oldValue = iterator.value!;
            const newValue = update(oldValue, key);

            if (newValue === undefined) {
                tree = iterator.remove();
                iterator = tree.gt(key);
            } else if (!Object.is(oldValue, newValue)) {
                tree = iterator.update(newValue);
                iterator = tree.gt(key);
            } else {
                iterator.next();
            }
        }

        if (tree === this._tree) return this;
        return new ImmutableMap(tree);
    }

    /**
     * Returns a new map with the entry associated with the passed key removed. The old
     * map is unchanged.
     *
     * Completes in O(log(n)) time.
     */
    public delete(key: Key): ImmutableMap<Key, Value> {
        const newTree = this._tree.remove(key);
        if (newTree === this._tree) return this;
        return new ImmutableMap(newTree);
    }

    /**
     * Gets a value from the map and returns a new map with the entry associated
     * removed. The old map is unchanged.
     *
     * Completes in O(log(n)) time.
     */
    public getAndDelete(key: Key): [Value | undefined, ImmutableMap<Key, Value>] {
        const node = this._tree.find(key);
        return node.valid ? [node.value, new ImmutableMap(node.remove())] : [undefined, this];
    }

    /**
     * Return the first entry in the map or undefined if the map is empty.
     */
    public getFirstEntry(): [Key, Value] | undefined {
        const iterator = this._tree.begin;
        if (!iterator.valid) return undefined;
        return [iterator.key!, iterator.value!];
    }

    /**
     * Return the last entry in the map or undefined if the map is empty.
     */
    public getLastEntry(): [Key, Value] | undefined {
        const iterator = this._tree.end;
        if (!iterator.valid) return undefined;
        return [iterator.key!, iterator.value!];
    }

    /**
     * Returns the entry after the provided key in the map. The key does not need to
     * exist in the map.
     */
    public getEntryAfter(key: Key): [Key, Value] | undefined {
        const iterator = this._tree.gt(key);
        if (!iterator.valid) return undefined;
        return [iterator.key!, iterator.value!];
    }

    /**
     * Returns the entry before the provided key in the map. The key does not need to
     * exist in the map.
     */
    public getEntryBefore(key: Key): [Key, Value] | undefined {
        const iterator = this._tree.lt(key);
        if (!iterator.valid) return undefined;
        return [iterator.key!, iterator.value!];
    }

    /**
     * Get the index of an entry in this immutable map by its key. If an entry doesn't
     * exist for this key we return undefined.
     */
    public getIndexByKey(key: Key): number | undefined {
        const iterator = this._tree.find(key);
        return iterator.valid ? iterator.index : undefined;
    }

    /**
     * Get an entry at the specific index in this immutable map. If an entry doesn't
     * exist for this index we return undefined.
     */
    public getEntryByIndex(index: number): [Key, Value] | undefined {
        const iterator = this._tree.at(index);
        if (!iterator.valid) return undefined;
        return [iterator.key!, iterator.value!];
    }

    /**
     * Returns a new iterator of all the keys in the map.
     *
     * Iterates in key order, not insertion order.
     */
    public *keys(): IterableIterator<Key> {
        const iterator = this._tree.begin;

        while (iterator.valid) {
            yield iterator.key!;
            iterator.next();
        }
    }

    /**
     * Returns a new iterator of all the keys in the map.
     *
     * Iterates in reverse key order.
     */
    public *keysReverse(): IterableIterator<Key> {
        const iterator = this._tree.end;

        while (iterator.valid) {
            yield iterator.key!;
            iterator.prev();
        }
    }

    /**
     * Returns a new iterator of all the values in the map.
     *
     * Iterates in key order, not insertion order.
     */
    public *values(): IterableIterator<Value> {
        const iterator = this._tree.begin;

        while (iterator.valid) {
            yield iterator.value!;
            iterator.next();
        }
    }

    /**
     * Returns a new iterator of all the values in the map.
     *
     * Iterates in reverse key order.
     */
    public *valuesReverse(): IterableIterator<Value> {
        const iterator = this._tree.end;

        while (iterator.valid) {
            yield iterator.value!;
            iterator.prev();
        }
    }

    /**
     * Returns a new iterator of all the entries in the map.
     *
     * Iterates in key order, not insertion order.
     */
    public *entries(): IterableIterator<[Key, Value]> {
        const iterator = this._tree.begin;

        while (iterator.valid) {
            yield [iterator.key!, iterator.value!];
            iterator.next();
        }
    }

    /**
     * Returns a new iterator of all the entries in the map.
     *
     * Iterates in reverse key order.
     */
    public *entriesReverse(): IterableIterator<[Key, Value]> {
        const iterator = this._tree.end;

        while (iterator.valid) {
            yield [iterator.key!, iterator.value!];
            iterator.prev();
        }
    }

    /**
     * Returns a new iterator of entries in the map before the provided key not
     * including the key.
     *
     * Iterates in reverse key order, not insertion order.
     */
    public *entriesBefore(beforeKey: Key): IterableIterator<[Key, Value]> {
        const iterator = this._tree.lt(beforeKey);

        while (iterator.valid) {
            yield [iterator.key!, iterator.value!];
            iterator.prev();
        }
    }

    /**
     * Returns a new iterator of entries in the map after the provided key not
     * including the key.
     *
     * Iterates in key order, not insertion order.
     */
    public *entriesAfter(afterKey: Key): IterableIterator<[Key, Value]> {
        const iterator = this._tree.gt(afterKey);

        while (iterator.valid) {
            yield [iterator.key!, iterator.value!];
            iterator.next();
        }
    }

    /**
     * Returns a new iterator of all the entries in the map.
     *
     * Iterates in key order, not insertion order.
     */
    public [Symbol.iterator](): IterableIterator<[Key, Value]> {
        return this.entries();
    }

    /**
     * Calls the provided callback once for every key-value pair.
     *
     * Iterates in key order, not insertion order.
     */
    public forEach(
        callback: (value: Value, key: Key, map: ImmutableMap<Key, Value>) => void,
        thisArg?: any,
    ): void {
        const iterator = this._tree.begin;

        while (iterator.valid) {
            callback.call(thisArg, iterator.value!, iterator.key!, this);
            iterator.next();
        }
    }

    /**
     * Returns a list of changes between `this` and `otherMap`. It is intended to be
     * efficient in the case where `this` and `otherMap` share a large amount of
     * structure. The keys in the output array will be in sorted order.
     */
    public symmetricDiff(otherMap: ImmutableMap<Key, Value>): Array<TreeChange<Key, Value>> {
        return symmetricDiffTree(this._tree, otherMap._tree);
    }
}
