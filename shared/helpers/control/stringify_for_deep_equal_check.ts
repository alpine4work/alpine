import {InvalidArgumentError} from "~/shared/error/error.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * Stringifies a value such that
 * `stringifyForDeepEqualCheck(value1) === stringifyForDeepEqualCheck(value2)`
 * should always be the same as `isDeepEqual(value1, value2)`.
 *
 * Useful if you are placing an arbitrary object into a `Map` key and want
 * structurally identical objects to map to the same thing. Or are interacting
 * with other systems and need a deep equality check that knows about
 * JavaScript semantics.
 *
 * Stringifies to a JSON-like language but because we support types like maps,
 * sets, and dates it's not exactly JSON. We don't currently have a parser for
 * this format.
 *
 * Throws an error if we run into an unsupported type. Unlike `isDeepEqual()`
 * which will return false.
 *
 * You could use the `json-stable-stringify` library if your value is plain
 * JSON.
 */
function actuallyStringifyForDeepEqualCheck(value: unknown): string {
    return stringifyForDeepEqualCheck(new Set(), value);
}

export {actuallyStringifyForDeepEqualCheck as stringifyForDeepEqualCheck};

function stringifyForDeepEqualCheck(seen: Set<unknown>, value: unknown): string {
    if (value !== null && typeof value === "object") {
        return stringifyObjectForDeepEqualCheck(seen, value as {readonly [key: string]: unknown});
    }

    // JSON doesn't support `undefined`.
    if (value === undefined) return "undefined";

    // JSON doesn't support some float values.
    if (typeof value === "number") {
        if (isNaN(value)) return "NaN";
        if (!isFinite(value)) return value < 0 ? "-Infinity" : "Infinity";
    }

    return JSON.stringify(value);
}

function stringifyObjectForDeepEqualCheck(
    seen: Set<unknown>,
    object: {readonly [key: string]: unknown},
): string {
    if (seen.has(object)) throw new InvalidArgumentError("Cycle detected in stringified value");
    seen.add(object);
    try {
        // Cast to a function without type narrowing.
        if (!(isPlainObject as (object: unknown) => boolean)(object)) {
            if (Array.isArray(object)) return stringifyArrayForDeepEqualCheck(seen, object);
            if (object instanceof Map) return stringifyMapForDeepEqualCheck(seen, object);
            if (object instanceof Set) return stringifySetForDeepEqualCheck(seen, object);
            if (object instanceof Date) return stringifyDateForDeepEqualCheck(seen, object);

            const constructorName = (object as any).constructor?.name ?? "";
            throw new InvalidArgumentError(quote`Unrecognized object ${constructorName}`);
        }

        const entries = [];

        // Object key order is irrelevant in `isDeepEqual()`.
        const keys = Object.keys(object).sort();

        for (const key of keys) {
            entries.push(`${JSON.stringify(key)}:${stringifyForDeepEqualCheck(seen, object[key])}`);
        }

        return `{${entries.join(",")}}`;
    } finally {
        seen.delete(object);
    }
}

function stringifyArrayForDeepEqualCheck(
    seen: Set<unknown>,
    array: ReadonlyArray<unknown>,
): string {
    const items = [];

    for (const item of array) {
        items.push(stringifyForDeepEqualCheck(seen, item));
    }

    return `[${items.join(",")}]`;
}

function stringifyMapForDeepEqualCheck(
    seen: Set<unknown>,
    map: ReadonlyMap<unknown, unknown>,
): string {
    const entries = [];

    for (const [key, value] of map) {
        entries.push({
            key: stringifyForDeepEqualCheck(seen, key),
            value: stringifyForDeepEqualCheck(seen, value),
        });
    }

    // Map item order does not matter in `isDeepEqual()`.
    entries.sort((entry1, entry2) => defaultCompareStrings(entry1.key, entry2.key));

    return `Map(${entries.map(entry => `${entry.key}:${entry.value}`).join(",")})`;
}

function stringifySetForDeepEqualCheck(seen: Set<unknown>, set: ReadonlySet<unknown>): string {
    const entries = [];

    for (const value of set) {
        entries.push(stringifyForDeepEqualCheck(seen, value));
    }

    // Set item order does not matter in `isDeepEqual()`.
    entries.sort();

    return `Set(${entries.join(",")})`;
}

function stringifyDateForDeepEqualCheck(seen: Set<unknown>, date: Date): string {
    return `Date(${JSON.stringify(date.toISOString())})`;
}
