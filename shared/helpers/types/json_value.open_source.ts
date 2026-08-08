/**
 * A JavaScript value that can be encoded, without change, as a [JSON][1] value. So
 * plain objects only, no functions, no classes.
 *
 * Notably, JSON does not support `undefined`. Only `null`. We support `undefined`
 * in object properties for convenience. `JSON.stringify()` removes property values
 * set to `undefined`. We should treat `undefined` and a missing property as the
 * same wherever possible.
 *
 * [1]: https://en.wikipedia.org/wiki/JSON
 */
export type JsonValue = JsonScalarValue | JsonObjectValue | JsonArrayValue;

/**
 * A JSON value which doesn't contain other values.
 */
export type JsonScalarValue = null | boolean | number | string;

/**
 * A JSON object value.
 */
export type JsonObjectValue = {
    readonly [key: string]: JsonValue | undefined;
};

/**
 * A JSON array value.
 */
export type JsonArrayValue = ReadonlyArray<JsonValue>;

/**
 * A JavaScript value with a meaningful JSON string representation but can not be
 * parsed back from JSON.
 *
 * The difference between this and `JsonValue` is we accept any object with a
 * `toJSON()` method. This tells us the object has a meaningful JSON string
 * representation.
 */
export type JsonStringifiableValue =
    | JsonScalarValue
    | {readonly [key: string]: JsonStringifiableValue | undefined}
    | ReadonlyArray<JsonStringifiableValue>
    | {toJSON(): string};

/**
 * Same as `JsonValue` but not read-only.
 */
export type JsonWritableValue = JsonScalarValue | JsonObjectWritableValue | JsonArrayWritableValue;

/**
 * Same as `JsonObjectValue` but not read-only.
 */
export type JsonObjectWritableValue = {
    [key: string]: JsonWritableValue | undefined;
};

/**
 * Same as `JsonArrayValue` but not read-only.
 */
export type JsonArrayWritableValue = Array<JsonWritableValue>;
