import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit.js";

/**
 * Clones an object but removes any keys in the key array. An implementation of the
 * TypeScript `Omit` type. Only copies object own properties.
 */
export function omitObject<Value extends {}, Keys extends string & keyof Value>(
    value: Value,
    keys: ReadonlyArray<Keys>,
): DistributiveOmit<Value, Keys> {
    const keySet = new Set<string>(keys);
    const newValue: {[key: string]: unknown} = {};

    for (const [key, keyValue] of Object.entries(value)) {
        if (keySet.has(key)) continue;
        newValue[key] = keyValue;
    }

    return newValue as DistributiveOmit<Value, Keys>;
}
