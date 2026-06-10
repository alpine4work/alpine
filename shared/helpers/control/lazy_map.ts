import {captureResult, unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

/**
 * A lazily computed infinite series of values. The first time you call `get(key)`
 * we will compute the value for that key and then never again.
 *
 * If the compute function throws then we save the thrown value and re-throw it
 * every time `get(key)` is called.
 *
 * It is safe to treat a lazy map as an immutable value. For the purposes of React
 * rendering or otherwise. Laziness can be thought of as an implementation detail
 * for improved efficiency of an otherwise immutable map.
 *
 * This class is similar to `DefaultMap` but different in that it is immutable.
 * With `DefaultMap` you can clear keys and iterate through keys. You may not clear
 * keys from `LazyMap` since that is a mutation and a `LazyMap` should be
 * considered immutable. You may not iterate through keys since that allows you to
 * observe `LazyMap`s underlying mutable state. To a consumer it should be no
 * different whether `LazyMap` computes all of its keys eagerly or lazily.
 *
 * Most of the time you probably want `DefaultMap`. Only use `LazyMap` if
 * immutability is important to you.
 */
export class LazyMap<Key, Value> {
    private readonly _map: Map<Key, Result<Value>>;
    private readonly _get: (key: Key) => Value;

    constructor(get: (key: Key) => Value) {
        this._map = new Map();
        this._get = get;
    }

    /**
     * Get the value. If a value has not yet been computed for this key then we will
     * compute it immediately.
     */
    public get(key: Key): Value {
        const result = getOrSetDefaultMapValue(this._map, key, () =>
            captureResult(() => this._get(key)),
        );
        return unwrapResult(result);
    }
}
