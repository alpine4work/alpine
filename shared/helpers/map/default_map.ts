import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {BlockInference} from "~/shared/helpers/types/block_inference.js";

/**
 * A map where you provide a function to generate default values in the
 * constructor. A new method on the map `getOrSetDefault()` allows you to get
 * an entry or call the default function if an entry doesn't already exist.
 *
 * We add a new method instead of overriding `get()` so that to downstream
 * consumers this is a regular map. For instance, if we pass a `ReadonlyMap` to
 * some function that calls `get()` they won't accidentally be setting a new
 * entry with the default.
 *
 * If you can't control how the map is constructed, use
 * `getOrSetDefaultMapValue()`.
 *
 * Similar to `LazyMap`. See the documentation on that class for how
 * `DefaultMap` differs. In short, use `DefaultMap` unless you want a value you
 * can treat as immutable. `LazyMap` has the interface of an immutable value.
 */
export class DefaultMap<Key, Value> extends Map<Key, Value> {
    public readonly getDefault: (key: Key) => Value;

    constructor(
        getDefault: (key: Key) => Value,
        entries?: ReadonlyArray<readonly [Key, Value]> | null,
    ) {
        super(entries);
        this.getDefault = getDefault;
    }

    /**
     * Get the existing value for this map entry or set a new entry using the
     * default function provided in the constructor.
     */
    public getOrSetDefault(key: Key): Value {
        return getOrSetDefaultMapValue(
            this,
            key,
            this.getDefault as (key: Key) => BlockInference<Value>,
        );
    }
}
