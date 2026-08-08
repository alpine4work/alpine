import createTree, {Tree} from "functional-red-black-tree";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";

// A bunch of methods have been added to `ReadonlySet` after upgrading to
// TypeScript 5.9.2 like `union()` and `intersection()`. It would be nice to
// implement these on `ImmutableSet` someday but for now adhere to this more
// limited `ReadonlySet` interface.
//
// TODO(calebmer, #typescript-5.9.2): Switch back to `implements ReadonlySet<T>`
// instead of `implements OldReadonlySet<T>`.
interface OldReadonlySet<T> {
    forEach(callbackfn: (value: T, value2: T, set: OldReadonlySet<T>) => void, thisArg?: any): void;
    has(value: T): boolean;
    readonly size: number;
    [Symbol.iterator](): IterableIterator<T>;
    entries(): IterableIterator<[T, T]>;
    keys(): IterableIterator<T>;
    values(): IterableIterator<T>;
}

assertAssignableTypes<ReadonlySet<unknown>, OldReadonlySet<unknown>>();

/**
 * A [persistent data structure][1] containing entries of key-value pairs. Each key
 * is associated with exactly one value. Aims for compatibility with the `Set` API.
 *
 * The performance of `has()` and `add()` in `ImmutableSet` is O(log(n)) while the
 * performance of `has()` and `add()` in `Set` is O(1). So most of the time `Set`
 * is faster! If you're using `Set` in an immutable context you can call
 * `new Set(oldSet)` to clone a map then call `add()` which is O(n).
 *
 * So `ImmutableSet` is faster if you need an immutable data structure and the
 * number of `has()`s and `add()`s is balanced. If you rarely `add()` and
 * frequently `has()` consider using a `Set` that you clone on `add()` instead.
 *
 * We don't use [Immutable.js][2] since that library is large and bloated.
 *
 * This map is backed by a [red-black tree][3] data structure.
 *
 * [1]: https://en.wikipedia.org/wiki/Persistent_data_structure
 * [2]: https://immutable-js.com/
 * [3]: https://en.wikipedia.org/wiki/Red%E2%80%93black_tree
 */
export class ImmutableSet<Value extends string | number> implements OldReadonlySet<Value> {
    private constructor(private readonly _tree: Tree<Value, true>) {}

    private static readonly _empty = new ImmutableSet(createTree<any, any>());

    /**
     * Creates a new empty set.
     *
     * A function so that you can provide new type parameters.
     *
     * All empty sets will be referentially equal to one another. So
     * `ImmutableSet.empty() === ImmutableSet.empty()`.
     */
    public static empty<Key extends string | number>(): ImmutableSet<Key> {
        return this._empty;
    }

    /**
     * Creates a new `ImmutableSet` from an entries iterable.
     *
     * You could use this to construct an `ImmutableSet` from a mutable `Set`.
     *
     * Completes in O(n \* log(n)) time.
     */
    public static from<Key extends string | number>(entries: Iterable<Key>): ImmutableSet<Key> {
        let map = ImmutableSet.empty<Key>();

        for (const key of entries) {
            map = map.add(key);
        }

        return map;
    }

    /**
     * Returns the number of key/value pairs in the set.
     */
    public get size(): number {
        return this._tree.length;
    }

    /**
     * Returns whether the value is in the set.
     *
     * Completes in O(log(n)) time.
     */
    public has(value: Value): boolean {
        return !!this._tree.get(value);
    }

    /**
     * Returns a new set with the entry associated with the passed key updated to the
     * new value. The old set is unchanged.
     *
     * Completes in O(log(n)) time.
     *
     * If the new value is already in the set then we will return the immutable map
     * as-is as an optimization.
     */
    public add(value: Value): ImmutableSet<Value> {
        const node = this._tree.find(value);
        if (node.valid) {
            // Optimization: If the value already exists, return the existing immutable map
            // without updating.
            return this;
        } else {
            return new ImmutableSet(this._tree.insert(value, true));
        }
    }

    /**
     * Returns a new set with the value removed. The old set is unchanged.
     *
     * Completes in O(log(n)) time.
     */
    public delete(key: Value): ImmutableSet<Value> {
        return new ImmutableSet(this._tree.remove(key));
    }

    /**
     * An alias for `ImmutableSet.values()`.
     */
    public *keys(): IterableIterator<Value> {
        const iterator = this._tree.begin;

        while (iterator.valid) {
            yield iterator.key!;
            iterator.next();
        }
    }

    /**
     * Returns a new iterator of all the values in the set.
     *
     * Iterates in value order, not insertion order.
     */
    public *values(): IterableIterator<Value> {
        const iterator = this._tree.begin;

        while (iterator.valid) {
            yield iterator.key!;
            iterator.next();
        }
    }

    /**
     * Returns a new iterator of values in the set returned as `[value, value]`. Same
     * as `ImmutableMap.entries()` except you can think of a set's key as being the
     * same as its value.
     *
     * Iterates in value order, not insertion order.
     */
    public *entries(): IterableIterator<[Value, Value]> {
        const iterator = this._tree.begin;

        while (iterator.valid) {
            yield [iterator.key!, iterator.key!];
            iterator.next();
        }
    }

    /**
     * Returns a new iterator of all the values in the map.
     *
     * Iterates in value order, not insertion order.
     */
    public [Symbol.iterator](): IterableIterator<Value> {
        return this.values();
    }

    /**
     * Calls the provided callback once for every value pair.
     *
     * Iterates in value order, not insertion order.
     */
    public forEach(
        callback: (value: Value, value2: Value, set: ImmutableSet<Value>) => void,
        thisArg?: any,
    ): void {
        const iterator = this._tree.begin;

        while (iterator.valid) {
            callback.call(thisArg, iterator.key!, iterator.key!, this);
            iterator.next();
        }
    }
}
