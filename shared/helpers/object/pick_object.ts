import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";

/**
 * Clones an object but only keys in the key array. An implementation of the
 * TypeScript `Pick` type. Only copies object own properties.
 */
export function pickObject<Value extends object, Keys extends string & keyof Value>(
    value: Value,
    keys: ReadonlyArray<Keys>,
): Pick<Value, Keys> {
    const newValue: {[key: string]: unknown} = {};

    for (const key of keys) {
        if (!hasOwnProperty(value, key)) continue;
        newValue[key] = value[key];
    }

    return newValue as Pick<Value, Keys>;
}
