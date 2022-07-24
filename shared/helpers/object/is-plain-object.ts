/**
 * Is the provided value a plain object?
 *
 * This means it is a non-null object with a prototype of `Object` or `null`.
 */
export function isPlainObject(value: unknown): value is {[key: string]: unknown} {
    if (typeof value !== "object" || value === null) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
}
