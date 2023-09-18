import {BlockInference} from "~/shared/helpers/types/block_inference.js";

/**
 * The limited map interface we need to implement `getOrSetDefaultMapValue()`.
 * This interface can match a `Map` or a `WeakMap` or a custom map
 * implementation.
 */
interface MapInterface<Key, Value> {
    get(key: Key): Value | undefined;
    has(key: Key): boolean;
    set(key: Key, value: Value): void;
}

/**
 * Get a value at the corresponding key from a map. If no entry for that key
 * exists then we will create an entry with the value from the provided
 * function.
 *
 * If you don't want to provide a single default function for an entire map,
 * use `DefaultMap`.
 */
export function getOrSetDefaultMapValue<Key, Value>(
    map: MapInterface<Key, Value>,
    key: BlockInference<Key>,
    // We use `BlockInference` here to ensure that the returned `Value` is the type
    // from our map and not a union of the map value and the return value of this
    // function.
    //
    // This also forces the return type of `getDefault` to match the map's value
    // type.
    getDefault: (key: Key) => BlockInference<Value>,
): Value {
    let value = map.get(key as Key);

    // We check for undefined so that if `value` is not undefined we don't need a
    // second map lookup. However, we need to check `has()` if the value is
    // undefined because undefined might be a valid map value.
    if (value === undefined && !map.has(key as Key)) {
        value = getDefault(key as Key) as Value;
        map.set(key as Key, value);
    }

    return value!;
}
