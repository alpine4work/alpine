/**
 * Is the provided value an object?
 *
 * May have any prototype.
 */
export function isObject(value: unknown): value is {[key: string]: unknown} {
    return typeof value === "object" && value !== null;
}
