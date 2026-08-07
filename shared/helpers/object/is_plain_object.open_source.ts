/**
 * Is the provided value a plain object?
 *
 * This means it is a non-null object with a prototype of `Object` or `null`.
 */
export function isPlainObject(value: unknown): value is {[key: string]: unknown} {
    if (typeof value !== "object" || value === null) return false;

    if (Object.getPrototypeOf(value) === null) {
        return true;
    }

    // This is the implementation lodash uses for `isPlainObject()`. It's not as direct
    // as checking `prototype === Object.prototype` but it supports plain objects
    // created in a different JavaScript realm.
    // https://github.com/lodash/lodash/blob/2da024c3b4f9947a48517639de7560457cd4ec6c/isPlainObject.js#L37-L41
    let prototype = value;
    while (Object.getPrototypeOf(prototype) !== null) {
        prototype = Object.getPrototypeOf(prototype);
    }
    return Object.getPrototypeOf(value) === prototype;
}
