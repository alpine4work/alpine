import createTree, {Tree} from "functional-red-black-tree";

/**
 * A [persistent data structure][1] containing entries of key-value pairs. Each
 * key is associated with exactly one value. Aims for compatibility with the
 * `Map` API.
 *
 * The performance of `get()` and `set()` in `ImmutableMap` is O(log(n)) while
 * the performance of `get()` and `set()` in `Map` is O(1). So most of the time
 * `Map` is faster! If you're using `Map` in an immutable context you can call
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
export class ImmutableMap<Key extends string | number, Value> implements ReadonlyMap<Key, Value> {
    private constructor(private readonly _tree: Tree<Key, Value>) {}

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
     * Completes in O(n * log(n)) time.
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
     * Returns the value associated to the passed key, or `undefined` if there
     * is none.
     *
     * Completes in O(log(n)) time.
     */
    public get(key: Key): Value | undefined {
        return this._tree.get(key) as Value | undefined;
    }

    /**
     * Returns a boolean indicating whether a value has been associated with the
     * passed key in the map or not.
     *
     * Completes in O(log(n)) time.
     */
    public has(key: Key): boolean {
        return !!this._tree.get(key);
    }

    /**
     * Returns a new map with the entry associated with the passed key updated to
     * the new value. The old map is unchanged.
     *
     * Completes in O(log(n)) time.
     *
     * If the new value is equal to the old value then we will return the immutable
     * map as-is as an optimization.
     */
    public set(key: Key, value: Value): ImmutableMap<Key, Value> {
        const node = this._tree.find(key);
        if (node.valid) {
            // Optimization: If the new value is equal to the old value, return the
            // existing immutable map without updating.
            if (Object.is(node.value, value)) return this;

            return new ImmutableMap(node.update(value));
        } else {
            return new ImmutableMap(this._tree.insert(key, value));
        }
    }

    /**
     * Returns a new map with the entry associated with the passed key removed.
     * The old map is unchanged.
     *
     * Completes in O(log(n)) time.
     */
    public delete(key: Key): ImmutableMap<Key, Value> {
        return new ImmutableMap(this._tree.remove(key));
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
     * Returns a new iterator of entries in the map after the provided key not
     * included the key.
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
    [Symbol.iterator](): IterableIterator<[Key, Value]> {
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
}
