import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";

/**
 * Get a property on an object but the property must be an own property. We will
 * not search the prototype chain.
 */
export function getOwnProperty<K extends string, V>(
    object: Partial<Record<K, V>>,
    key: K,
): V | undefined;
export function getOwnProperty(obj: object, key: string): unknown;
export function getOwnProperty(obj: object, key: string): unknown {
    if (!hasOwnProperty(obj, key)) {
        return undefined;
    }
    return obj[key];
}
