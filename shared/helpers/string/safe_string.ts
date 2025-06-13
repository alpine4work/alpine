import {assert} from "~/shared/helpers/control/assert.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";

const safeStringTag = Symbol("safe");

/**
 * A string that does not allow arbitrary user input. This helper can be used
 * to prevent injection attacks like SQL injection or XSS.
 *
 * Most of safe string contents is hard coded by the developer. We allow some
 * dynamic data in a safe string, like `Id`s, that are harmless and when used
 * properly are not code injection vectors.
 *
 * We have both type system and runtime protections against user input finding
 * its way into a safe string. Even if an attacker is able to inject an
 * arbitrary JSON value into a safe string, we are still able to reject it.
 *
 * If you're using `dangerouslySetInnerHTML` in React then consider using a safe
 * string.
 */
export type SafeString = {
    readonly _tag: typeof safeStringTag;
    readonly string: string;
};

/**
 * A template string tag that creates a safe string without user input.
 */
export function safe(
    templateStrings: TemplateStringsArray,
    ...values: Array<SafeString>
): SafeString {
    assert(templateStrings.length > 0);
    assert(templateStrings.length === values.length + 1);

    let string = "";

    for (let i = 0; i < templateStrings.length; i++) {
        if (i !== 0) {
            const value = values[i - 1];
            assert(isSafeString(value));
            string += value.string;
        }
        string += templateStrings[i];
    }

    return {_tag: safeStringTag, string};
}

/**
 * Safely embeds a number in a `SafeString`.
 *
 * Stringifies the number to a JavaScript code literal. So `NaN` will be `NaN`
 * and `Infinity` will be `Infinity`. Regular integers and floats are JSON
 * compatible but `NaN` and `Infinity` are not so you'll need some validation
 * on your end when using with JSON.
 *
 * Be careful how you use this utility as you're potentially allowing user
 * input in a `SafeString`! Make sure you use this somewhere that supports a
 * string in a JavaScript number literal format.
 */
export function safeNumber(number: number): SafeString {
    assert(typeof number === "number");
    return {_tag: safeStringTag, string: String(number)};
}

/**
 * Safely embed an alphanumeric string (only ascii letters and numbers) in
 * a `SafeString`.
 *
 * Be careful how you use this utility as you're potentially allowing user
 * input in a `SafeString`! Make sure you use this somewhere that supports an
 * alphanumeric string and the string can't do anything bad.
 */
export function safeAlphanumericString(string: string): SafeString {
    assert(/^[a-z0-9]+$/.test(string));
    return {_tag: safeStringTag, string};
}

/**
 * Safely embed an identifier string (only ascii letters, numbers, and `_`) in
 * a `SafeString`.
 *
 * Be careful how you use this utility as you're potentially allowing user
 * input in a `SafeString`! Make sure you use this somewhere that supports an
 * identifier string and the string can't do anything bad.
 */
export function safeIdentifierString(string: string): SafeString {
    assert(isIdentifier(string));
    return {_tag: safeStringTag, string};
}

/**
 * Joins many `SafeString`s together. Behaves the same as `String.join()`. All
 * inputs must be safe strings so we can be sure the returned type is also a
 * safe string.
 */
export function safeJoin(
    safeStrings: ReadonlyArray<SafeString>,
    safeJoinString: SafeString,
): SafeString {
    assert(isSafeString(safeJoinString));

    let string = "";

    for (let i = 0; i < safeStrings.length; i++) {
        const safeString = safeStrings[i]!;
        assert(isSafeString(safeString));

        if (i !== 0) {
            string += safeJoinString.string;
        }

        string += safeString.string;
    }

    return {_tag: safeStringTag, string};
}

/**
 * Checks that the parameter is, indeed, a safe string.
 */
export function isSafeString(string: unknown): string is SafeString {
    return isPlainObject(string) && string._tag === safeStringTag;
}

/**
 * Converts any string into a SafeString. Use sparingly and wisely.
 * We use SafeString in places we want to prevent attacks like SQL injection or XSS.
 *
 * If you use this it's on you to guarantee your string isn't supplied by a user.
 */
export function dangerouslyCreateSafeString(string: string): SafeString {
    return {_tag: safeStringTag, string};
}

/**
 * Safely embed an object key. Tests for alphanumeric plus '#', '_', and '-'.
 *
 * Be careful how you use this utility as you're potentially allowing user
 * input in a `SafeString`! Make sure you use this somewhere that supports an
 * alphanumeric string and the string can't do anything bad.
 */
function safeObjectEntryString(string: string): SafeString {
    assert(/^[a-zA-Z0-9#_-]+$/.test(string));
    return {_tag: safeStringTag, string};
}

/**
 * Creates a safe JS object of string keys and values.
 */
export function safeFlatObjectString(
    object: Readonly<Record<string, string | number | boolean>>,
): SafeString {
    const entries: Array<SafeString> = [];
    for (const [key, value] of Object.entries(object)) {
        let safeValue;
        if (typeof value === "string") {
            safeValue = safeJoin([safe`"`, safeObjectEntryString(value), safe`"`], safe``);
        } else if (typeof value === "number") {
            safeValue = safeNumber(value);
        } else {
            safeValue = value ? safe`true` : safe`false`;
        }

        const safeKey = safeObjectEntryString(key);
        const entry = safeJoin([safe`"`, safeKey, safe`": `, safeValue], safe``);
        entries.push(entry);
    }

    return safeJoin([safe`{`, safeJoin(entries, safe`,`), safe`}`], safe``);
}
