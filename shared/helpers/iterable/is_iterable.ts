import {isObject} from "~/shared/helpers/object/is_object.js";

/**
 * Is the provided value an iterable? An iterable is any object with the
 * `Symbol.iterator` property.
 */
export function isIterable<Value>(value: unknown): value is Iterable<Value> {
    if (!isObject(value)) return false;
    return typeof value[Symbol.iterator] === "function";
}
