import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";

/**
 * Determines if two plain objects are shallowly equal to one another. Looks at
 * both objects own keys and makes sure they are exactly equal with
 * `Object.is()` (which behaves the same as `===` except for `NaN`).
 *
 * Returns false if either object is not a plain object.
 */
export function isShallowEqual(
    object1: {[key: string]: unknown},
    object2: {[key: string]: unknown},
): boolean {
    if (object1 === object2) return true;

    if (!isPlainObject(object1) || !isPlainObject(object2)) return false;

    const object1Keys = new Set(Object.keys(object1));

    for (const [key, value2] of Object.entries(object2)) {
        if (!object1Keys.delete(key)) return false;

        if (!hasOwnProperty(object1, key)) return false;
        const value1 = object1[key];

        // For numbers, `Object.is()` considers `NaN` as equal to `NaN`. This is the
        // same algorithm used by `Set.has()` and `Map.has()`.
        // See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is
        if (!Object.is(value1, value2)) return false;
    }

    return object1Keys.size === 0;
}
