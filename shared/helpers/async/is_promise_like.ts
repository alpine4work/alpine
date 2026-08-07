import {isObject} from "~/shared/helpers/object/is_object.open_source.js";

/**
 * Does the provided value adhere to the promise interface? If the object has a
 * `then()` function then it does.
 */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return isObject(value) && typeof value["then"] === "function";
}
