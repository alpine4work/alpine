import {isEqual as areDatesEqual} from "date-fns/isEqual";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.open_source.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.open_source.js";

/**
 * A value that can be safely passed into `isDeepEqual()`. Functions and custom
 * classes aren't safe since we'll only perform a referential equality check. It's
 * recommended that you use `isDeepEqualWithSchema()` if your object has custom
 * classes. You can also use `isDeepEqualForUnknownValues()` if you want to ignore
 * the "safe" types for `isDeepEqual()`.
 */
export type ValueForDeepEqual = ScalarValueForDeepEqual | CompositeValueForDeepEqual;

type ScalarValueForDeepEqual = undefined | null | boolean | number | string | Date | Uint8Array;

type CompositeValueForDeepEqual =
    | ObjectValueForDeepEqual
    | ArrayValueForDeepEqual
    | MapValueForDeepEqual
    | SetValueForDeepEqual;

type ObjectValueForDeepEqual = {
    readonly [key: string]: ValueForDeepEqual;
};

type ArrayValueForDeepEqual = ReadonlyArray<ValueForDeepEqual>;

type MapValueForDeepEqual = ReadonlyMap<ValueForDeepEqual, ValueForDeepEqual>;

type SetValueForDeepEqual = ReadonlySet<ValueForDeepEqual>;

/**
 * Checks if two values deeply equal each other.
 *
 * Our deep equality algorithm supports:
 *
 * - Primitive values (strings, numbers, booleans, etc.)
 * - Plain object values (object with no prototype)
 * - Arrays
 * - Maps
 * - Sets
 * - Dates
 * - `Uint8Array`s
 *
 * For numbers, `+0` and `-0` are considered equal. `NaN` is also considered to
 * equal `NaN`.
 *
 * For `Map`s and `Set`s the insertion order does not matter.
 *
 * The contents of a `Set` must be referentially equal. We will not try to check
 * deep equality on set values if they are objects. Same with `Map` keys.
 *
 * For non-plain object values that aren't otherwise supported (e.g. ProseMirror
 * `Node`s) we'll check referential equality (`a === b`) and if that fails we'll
 * return false.
 *
 * If you have non-plain object value consider using `isDeepEqualWithSchema()`
 * instead which first uses a schema to serialize to JSON and then performs a deep
 * equality check on the serialized value.
 */
// NOTE(calebmer): I chose to manually write a deep equality implementation instead
// of using the common Lodash implementation since at a previous job I discovered
// Lodash considers `isEqual(new Map([['x', [1, 2]]]), new Map([['x', [2, 1]]]))`
// to be true! Beware of Lodash deep equality.
export function isDeepEqual(value1: ValueForDeepEqual, value2: ValueForDeepEqual): boolean {
    return isDeepEqualForUnknownValues(value1, value2);
}

/**
 * Same as `isDeepEqual()` but doesn't check whether the types are "safe" for our
 * deep equality check. Prefer using `isDeepEqualWithSchema()` which is safe for
 * types with custom classes since it first serializes to JSON.
 */
export function isDeepEqualForUnknownValues(value1: unknown, value2: unknown): boolean {
    if (value1 === value2) return true;

    if (
        value1 !== null &&
        value2 !== null &&
        typeof value1 === "object" &&
        typeof value2 === "object"
    ) {
        return areObjectsDeeplyEqual(
            value1 as {readonly [key: string]: unknown},
            value2 as {readonly [key: string]: unknown},
        );
    }

    // For numbers, `Object.is()` considers `NaN` as equal to `NaN`. This is the same
    // algorithm used by `Set.has()` and `Map.has()`. See:
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is
    if (typeof value1 === "number" && typeof value2 === "number") {
        return Object.is(value1, value2);
    }

    return false;
}

function areObjectsDeeplyEqual(
    object1: {readonly [key: string]: unknown},
    object2: {readonly [key: string]: unknown},
): boolean {
    if (object1 === object2) return true;

    if (!isPlainObject(object1) || !isPlainObject(object2)) {
        if (Array.isArray(object1) && Array.isArray(object2))
            return areArraysDeeplyEqual(object1, object2);

        if (object1 instanceof Map && object2 instanceof Map)
            return areMapsDeeplyEqual(object1, object2);

        if (object1 instanceof Set && object2 instanceof Set)
            return areSetsDeeplyEqual(object1, object2);

        if (object1 instanceof Date && object2 instanceof Date)
            return areDatesEqual(object1, object2);

        if (object1 instanceof Uint8Array && object2 instanceof Uint8Array)
            return areArraysDeeplyEqual(object1, object2);

        return false;
    }

    const object1Keys = new Set(Object.keys(object1));

    for (const [key, value2] of Object.entries(object2)) {
        if (!object1Keys.delete(key)) return false;

        if (!hasOwnProperty(object1, key)) return false;
        const value1 = object1[key];

        if (!isDeepEqualForUnknownValues(value1, value2)) return false;
    }

    return object1Keys.size === 0;
}

function areArraysDeeplyEqual(array1: ArrayLike<unknown>, array2: ArrayLike<unknown>): boolean {
    if (array1.length !== array2.length) return false;

    for (let index = 0; index < array1.length; index++) {
        if (!isDeepEqualForUnknownValues(array1[index], array2[index])) return false;
    }

    return true;
}

function areMapsDeeplyEqual(
    map1: ReadonlyMap<unknown, unknown>,
    map2: ReadonlyMap<unknown, unknown>,
): boolean {
    if (map1.size !== map2.size) return false;

    const map1Keys = new Set(map1.keys());

    for (const [key, value2] of map2) {
        if (!map1Keys.delete(key)) return false;

        const value1 = map1.get(key)!;
        if (!isDeepEqualForUnknownValues(value1, value2)) return false;
    }

    return map1Keys.size === 0;
}

function areSetsDeeplyEqual(set1: ReadonlySet<unknown>, set2: ReadonlySet<unknown>): boolean {
    if (set1.size !== set2.size) return false;

    const clonedSet1 = new Set(set1);

    for (const item of set2) {
        if (!clonedSet1.delete(item)) return false;
    }

    return clonedSet1.size === 0;
}
