import {AdvancedWeakValuesMap} from "~/shared/helpers/map/advanced_weak_values_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

/**
 * A `StoreMap` is a `Map` of keys to values where you can also get a `Store`
 * object for arbitrary keys that lets you observe changes to the key over time
 * without observing changes to the map as a whole. It also lets you mutate the map
 * in O(1) time instead of O(n) time.
 *
 * The alternative is to use a `Store<Map<Key, Value>>`. With that variant if you
 * wanted to read a single key you'd end up getting an update whenever anything in
 * the map changed. If you wanted to write to a single key then you'd have to clone
 * the map which is O(n) since store values should be immutable.
 *
 * As a tradeoff you can't iterate over entries in the map. Since that requires
 * subscribing to every change in the map.
 */
export class StoreMap<Key, Value> {
    private readonly _map: Map<Key, Value>;

    // Users of this class do not observe non-determinism due to JavaScript garbage
    // collector timing. Yay!
    private readonly _storeMap = new AdvancedWeakValuesMap<Key, ValueStore<Value | undefined>>();

    constructor(entries?: ReadonlyArray<readonly [Key, Value]> | null) {
        this._map = new Map(entries);
    }

    public get sizeSnapshot() {
        return this._map.size;
    }

    /**
     * Gets a snapshot of the current value for the key. You are only seeing the
     * current value and won't be able to observe changes over time. You should use
     * `get()` to observe changes to the key over time.
     */
    public getSnapshot(key: Key): Value | undefined {
        return this._map.get(key);
    }

    public hasSnapshot(key: Key): boolean {
        return this._map.has(key);
    }

    private readonly _createStore = (key: Key) => {
        return new ValueStore(this._map.get(key));
    };

    /**
     * Returns a store that lets you observe changes to this key over time without
     * observing changes to other keys in the map.
     *
     * If the key does not exist in the map then the store will return `undefined`. If
     * the key exists when you call this function you'll get `Value` but if it is later
     * deleted you'll get `undefined` again.
     *
     * Unused stores are cleaned up automatically.
     */
    public get(key: Key): Store<Value | undefined> {
        return getOrSetDefaultMapValue(this._storeMap, key, this._createStore);
    }

    /**
     * Update the value associated with this key in our map. If someone is listening to
     * a store for this key then they'll get a notification.
     */
    public set(key: Key, value: Value): void {
        this._map.set(key, value);
        this._storeMap.get(key)?.set(value);
    }

    /**
     * Delete the value associated with this key in our map. If someone is listening to
     * a store for this key then they'll get a notification.
     */
    public delete(key: Key): boolean {
        const wasDeleted = this._map.delete(key);
        this._storeMap.get(key)?.set(undefined);
        return wasDeleted;
    }

    public keysSnapshot() {
        return this._map.keys();
    }

    public valuesSnapshot() {
        return this._map.values();
    }

    public entriesSnapshot() {
        return this._map.entries();
    }
}
