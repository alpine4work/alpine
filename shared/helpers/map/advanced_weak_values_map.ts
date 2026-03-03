import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Like `WeakMap` but holds its values weakly instead of its keys. When the value
 * is garbage collected, the key is removed from the map.
 *
 * This class takes more care to use than `WeakMap` since you can observe
 * JavaScript garbage collector behavior.
 *
 * Here are some specific points included by the authors in the [proposal][1] that
 * introduced `WeakRef` (which makes this API possible):
 *
 * > [Garbage collectors][2] are complicated. If an application or library depends
 * > on GC cleaning up a `WeakRef` or calling a finalizer cleanup callback in a
 * > timely, predictable manner, it's likely to be disappointed: the cleanup may
 * > happen much later than expected, or not at all. Sources of variability
 * > include:
 * >
 * > - One object might be garbage-collected much sooner than another object, even
 * >   if they become unreachable at the same time, e.g., due to generational
 * >   collection.
 * > - Garbage collection work can be split up over time using incremental and
 * >   concurrent techniques.
 * > - Various runtime heuristics can be used to balance memory usage,
 * >   responsiveness.
 * > - The JavaScript engine may hold references to things which look like they are
 * >   unreachable (e.g., in closures, or inline caches).
 * > - Different JavaScript engines may do these things differently, or the same
 * >   engine may change its algorithms across versions.
 * > - Complex factors may lead to objects being held alive for unexpected amounts
 * >   of time, such as use with certain APIs.
 *
 * We add "advanced" to this class's name to discourage usage unless you are
 * comfortable with the tradeoffs.
 *
 * [1]: https://github.com/tc39/proposal-weakrefs
 * [2]: https://en.wikipedia.org/wiki/Garbage_collection_(computer_science)
 */
export class AdvancedWeakValuesMap<Key, Value extends object> {
    private readonly _map = new Map<Key, WeakRef<Value>>();

    private readonly _finalizationRegistry = new FinalizationRegistry<Key>(key => {
        // Make sure the value in the map is actually dead and we didn't call `set()` with
        // a live value replacing the garbage collected value.
        const valueRef = this._map.get(key);
        if (valueRef && !valueRef.deref()) this._map.delete(key);
    });

    public getSizeForTest() {
        assert(import.meta.jest);
        return this._map.size;
    }

    /**
     * Returns a value from this map.
     *
     * If we previously `set()` the value but then the value was garbage collected
     * because there were no more references to it then this function will return
     * `undefined`.
     */
    public get(key: Key): Value | undefined {
        return this._map.get(key)?.deref();
    }

    /**
     * Does the map contain an entry for this key?
     *
     * If we previously `set()` the value but then the value was garbage collected
     * because there were no more references to it then this function will return
     * `false`.
     */
    public has(key: Key): boolean {
        return this.get(key) !== undefined;
    }

    /**
     * Add an entry to this map for the provided key.
     *
     * The entry will eventually be cleaned up if there are no other references to
     * `value` in the program.
     */
    public set(key: Key, value: Value): void {
        this._map.set(key, new WeakRef(value));
        this._finalizationRegistry.register(value, key);
    }

    /**
     * Delete a key from the map.
     */
    public delete(key: Key): boolean {
        return this._map.delete(key);
    }
}
