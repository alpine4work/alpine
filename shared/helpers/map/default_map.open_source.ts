import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";

/**
 * A map where you provide a function to generate default values in the
 * constructor. A new method on the map `getOrSetDefault()` allows you to get an
 * entry or call the default function if an entry doesn't already exist.
 *
 * We add a new method instead of overriding `get()` so that to downstream
 * consumers this is a regular map. For instance, if we pass a `ReadonlyMap` to
 * some function that calls `get()` they won't accidentally be setting a new entry
 * with the default.
 *
 * If you can't control how the map is constructed, use
 * `getOrSetDefaultMapValue()`.
 *
 * Similar to `LazyMap`. See the documentation on that class for how `DefaultMap`
 * differs. In short, use `DefaultMap` unless you want a value you can treat as
 * immutable. `LazyMap` has the interface of an immutable value.
 */
export class DefaultMap<Key, Value> extends Map<Key, Value> {
    private readonly _getDefault: (key: Key) => Value;

    constructor(getDefault: (key: Key) => Value, entries?: Iterable<readonly [Key, Value]> | null) {
        super(entries);
        this._getDefault = getDefault;
    }

    /**
     * Create a new map reusing the "get default" function from this map.
     */
    public newWithGetDefault(entries?: Iterable<readonly [Key, Value]> | null) {
        return new DefaultMap(this._getDefault, entries);
    }

    /**
     * Get the existing value for this map entry or set a new entry using the default
     * function provided in the constructor.
     */
    public getOrSetDefault(key: Key): Value {
        return getOrSetDefaultMapValue<Map<Key, Value>>(this, key, this._getDefault);
    }
}
