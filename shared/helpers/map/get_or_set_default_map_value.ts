/**
 * The limited map interface we need to implement `getOrSetDefaultMapValue()`. This
 * interface can match a `Map` or a `WeakMap` or a custom map implementation.
 */
interface MapInterface<Key, Value> {
    get(key: Key): Value | undefined;
    has(key: Key): boolean;
    set(key: Key, value: Value): void;
}

type MapKeyType<Map extends MapInterface<any, any>> =
    Map extends MapInterface<infer Key, any> ? Key : never;

type MapValueType<Map extends MapInterface<any, any>> =
    Map extends MapInterface<any, infer Value> ? Value : never;

/**
 * Get a value at the corresponding key from a map. If no entry for that key exists
 * then we will create an entry with the value from the provided function.
 *
 * If you don't want to provide a single default function for an entire map, use
 * `DefaultMap`.
 */
// We have `Map` be the generic type instead of doing `<Key, Value>` generics
// because we don't want the `key` argument or `getDefault` argument to contribute
// to what the `Key`/`Value` types are inferred to be.
export function getOrSetDefaultMapValue<Map extends MapInterface<any, any>>(
    map: Map,
    key: MapKeyType<Map>,
    // We use `BlockInference` here to ensure that the returned `Value` is the type
    // from our map and not a union of the map value and the return value of this
    // function.
    //
    // This also forces the return type of `getDefault` to match the map's value type.
    getDefault: (key: MapKeyType<Map>) => MapValueType<Map>,
): MapValueType<Map> {
    let value = map.get(key);

    // We check for undefined so that if `value` is not undefined we don't need a
    // second map lookup. However, we need to check `has()` if the value is undefined
    // because undefined might be a valid map value.
    if (value === undefined && !map.has(key)) {
        value = getDefault(key);
        map.set(key, value);
    }

    return value;
}
