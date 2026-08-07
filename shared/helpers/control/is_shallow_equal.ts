import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.open_source.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.open_source.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.open_source.js";

/**
 * Determines if two plain objects or arrays are shallowly equal to one another.
 * Looks at both objects own keys and makes sure they are exactly equal with
 * `Object.is()` (which behaves the same as `===` except for `NaN`).
 *
 * Returns false if either object is not a plain object or array.
 */
export function isShallowEqual(
    object1: {[key: string]: unknown} | ReadonlyArray<unknown>,
    object2: {[key: string]: unknown} | ReadonlyArray<unknown>,
): boolean {
    if (Object.is(object1, object2)) return true;

    if (isPlainObject(object1) && isPlainObject(object2)) {
        const object1Keys = new Set(Object.keys(object1));

        for (const [key, value2] of Object.entries(object2)) {
            if (!object1Keys.delete(key)) return false;

            if (!hasOwnProperty(object1, key)) return false;
            const value1 = object1[key];

            // For numbers, `Object.is()` considers `NaN` as equal to `NaN`. This is the same
            // algorithm used by `Set.has()` and `Map.has()`. See:
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is
            if (!Object.is(value1, value2)) return false;
        }

        return object1Keys.size === 0;
    }

    if (isReadonlyArray(object1) && isReadonlyArray(object2)) {
        if (object1.length !== object2.length) return false;

        for (let i = 0; i < object1.length; i++) {
            // For numbers, `Object.is()` considers `NaN` as equal to `NaN`. This is the same
            // algorithm used by `Set.has()` and `Map.has()`. See:
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is
            if (!Object.is(object1[i], object2[i])) return false;
        }

        return true;
    }

    return false;
}
