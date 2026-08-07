import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.open_source.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

/**
 * A value that can be passed into `stringifyForDeepEqualCheck()`. Functions and
 * custom classes can't be passed to `stringifyForDeepEqualCheck()`. We'll throw an
 * error if you try.
 *
 * Only certain primitive types are handled.
 */
export type StringifiableValueForDeepEqualCheck<ReplacedValue = never> =
    | StringifiableScalarValueForDeepEqualCheck
    | StringifiableCompositeValueForDeepEqualCheck<ReplacedValue>
    | ReplacedValue;

type StringifiableScalarValueForDeepEqualCheck =
    | undefined
    | null
    | boolean
    | number
    | string
    | Date
    | Uint8Array;

type StringifiableCompositeValueForDeepEqualCheck<ReplacedValue> =
    | StringifiableObjectValueForDeepEqualCheck<ReplacedValue>
    | StringifiableArrayValueForDeepEqualCheck<ReplacedValue>
    | StringifiableMapValueForDeepEqualCheck<ReplacedValue>
    | StringifiableSetValueForDeepEqualCheck<ReplacedValue>;

type StringifiableObjectValueForDeepEqualCheck<ReplacedValue> = {
    readonly [key: string]: StringifiableValueForDeepEqualCheck<ReplacedValue>;
};

type StringifiableArrayValueForDeepEqualCheck<ReplacedValue> = ReadonlyArray<
    StringifiableValueForDeepEqualCheck<ReplacedValue>
>;

type StringifiableMapValueForDeepEqualCheck<ReplacedValue> = ReadonlyMap<
    StringifiableValueForDeepEqualCheck<ReplacedValue>,
    StringifiableValueForDeepEqualCheck<ReplacedValue>
>;

type StringifiableSetValueForDeepEqualCheck<ReplacedValue> = ReadonlySet<
    StringifiableValueForDeepEqualCheck<ReplacedValue>
>;

/**
 * Stringifies a value such that
 * `stringifyForDeepEqualCheck(value1) === stringifyForDeepEqualCheck(value2)`
 * should always be the same as `isDeepEqual(value1, value2)`.
 *
 * Useful if you are placing an arbitrary object into a `Map` key and want
 * structurally identical objects to map to the same thing. Or are interacting with
 * other systems and need a deep equality check that knows about JavaScript
 * semantics.
 *
 * Stringifies to a JSON-like language but because we support types like maps,
 * sets, and dates it's not exactly JSON. We don't currently have a parser for this
 * format. Currently, this format is a subset of JavaScript.
 *
 * Throws an error if we run into an unsupported type. Unlike `isDeepEqual()` which
 * will return false. You may provide a `replacer` function to stringify these
 * types in a custom way.
 *
 * You could use the `json-stable-stringify` library if your value is plain JSON.
 */
function actuallyStringifyForDeepEqualCheck(
    value: StringifiableValueForDeepEqualCheck<never>,
): string;
function actuallyStringifyForDeepEqualCheck<ReplacedValue>(
    value: StringifiableValueForDeepEqualCheck<ReplacedValue>,
    replacer: (value: ReplacedValue) => StringifiableValueForDeepEqualCheck<ReplacedValue>,
): string;
function actuallyStringifyForDeepEqualCheck<ReplacedValue>(
    value: StringifiableValueForDeepEqualCheck<ReplacedValue>,
    replacer: (value: ReplacedValue) => StringifiableValueForDeepEqualCheck<ReplacedValue> = (
        value: any,
    ): never => {
        const constructorName = value.constructor?.name ?? "";
        throw new InvalidArgumentError(quote`Unrecognized object ${constructorName}`);
    },
): string {
    return stringifyForDeepEqualCheck(value, replacer, new Set());
}

export {actuallyStringifyForDeepEqualCheck as stringifyForDeepEqualCheck};

function stringifyForDeepEqualCheck<ReplacedValue>(
    value: StringifiableValueForDeepEqualCheck<ReplacedValue>,
    replacer: (value: ReplacedValue) => StringifiableValueForDeepEqualCheck<ReplacedValue>,
    seen: Set<unknown>,
): string {
    if (value !== null && typeof value === "object") {
        return stringifyObjectForDeepEqualCheck(value, replacer, seen);
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

function stringifyObjectForDeepEqualCheck<ReplacedValue>(
    object:
        | StringifiableCompositeValueForDeepEqualCheck<ReplacedValue>
        | Date
        | Uint8Array
        | (ReplacedValue & {}),
    replacer: (value: ReplacedValue) => StringifiableValueForDeepEqualCheck<ReplacedValue>,
    seen: Set<unknown>,
): string {
    if (seen.has(object)) throw new InvalidArgumentError("Cycle detected in stringified value");
    seen.add(object);
    try {
        // Cast to a function without type narrowing.
        if (!isPlainObject(object)) {
            if (Array.isArray(object))
                return stringifyArrayForDeepEqualCheck(object, replacer, seen);
            if (object instanceof Map) return stringifyMapForDeepEqualCheck(object, replacer, seen);
            if (object instanceof Set) return stringifySetForDeepEqualCheck(object, replacer, seen);
            if (object instanceof Date) return stringifyDateForDeepEqualCheck(object);
            if (object instanceof Uint8Array) return stringifyUint8ArrayForDeepEqualCheck(object);

            // If we don't recognize the type, call our replacer.
            return stringifyForDeepEqualCheck(replacer(object as any), replacer, seen);
        }

        const entries = [];

        // Object key order is irrelevant in `isDeepEqual()`.
        const keys = Object.keys(object).sort();

        for (const key of keys) {
            entries.push(
                `${JSON.stringify(key)}:${stringifyForDeepEqualCheck(
                    (object as any)[key],
                    replacer,
                    seen,
                )}`,
            );
        }

        return `{${entries.join(",")}}`;
    } finally {
        seen.delete(object);
    }
}

function stringifyArrayForDeepEqualCheck<ReplacedValue>(
    array: ReadonlyArray<StringifiableValueForDeepEqualCheck<ReplacedValue>>,
    replacer: (value: ReplacedValue) => StringifiableValueForDeepEqualCheck<ReplacedValue>,
    seen: Set<unknown>,
): string {
    const items = [];

    for (const item of array) {
        items.push(stringifyForDeepEqualCheck(item, replacer, seen));
    }

    return `[${items.join(",")}]`;
}

function stringifyUint8ArrayForDeepEqualCheck(array: Uint8Array): string {
    const items = [];

    for (const item of array) {
        items.push(item);
    }

    return `Uint8Array([${items.join(",")}])`;
}

function stringifyMapForDeepEqualCheck<ReplacedValue>(
    map: ReadonlyMap<
        StringifiableValueForDeepEqualCheck<ReplacedValue>,
        StringifiableValueForDeepEqualCheck<ReplacedValue>
    >,
    replacer: (value: ReplacedValue) => StringifiableValueForDeepEqualCheck<ReplacedValue>,
    seen: Set<unknown>,
): string {
    const entries = [];

    for (const [key, value] of map) {
        entries.push({
            key: stringifyForDeepEqualCheck(key, replacer, seen),
            value: stringifyForDeepEqualCheck(value, replacer, seen),
        });
    }

    // Map item order does not matter in `isDeepEqual()`.
    entries.sort((entry1, entry2) => defaultCompareStrings(entry1.key, entry2.key));

    return `Map({${entries.map(entry => `${entry.key}:${entry.value}`).join(",")}})`;
}

function stringifySetForDeepEqualCheck<ReplacedValue>(
    set: ReadonlySet<StringifiableValueForDeepEqualCheck<ReplacedValue>>,
    replacer: (value: ReplacedValue) => StringifiableValueForDeepEqualCheck<ReplacedValue>,
    seen: Set<unknown>,
): string {
    const entries = [];

    for (const value of set) {
        entries.push(stringifyForDeepEqualCheck(value, replacer, seen));
    }

    // Set item order does not matter in `isDeepEqual()`.
    entries.sort();

    return `Set(${entries.join(",")})`;
}

function stringifyDateForDeepEqualCheck(date: Date): string {
    return `Date(${JSON.stringify(date.toISOString())})`;
}
