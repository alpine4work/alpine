import {assert} from "~/shared/helpers/control/assert";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object";
import {Id, isId} from "~/shared/id/id";

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
 * Safely embeds an `Id` in a `SafeString`.
 *
 * Be careful how you use this utility as you're potentially allowing user
 * input in a `SafeString`! Make sure you use this somewhere that supports a
 * string in an `Id` format.
 */
export function safeId(id: Id): SafeString {
    // Be certain that the input string is actually an `Id`.
    assert(isId(id));

    return {_tag: safeStringTag, string: id};
}

/**
 * Checks that the parameter is, indeed, a safe string.
 */
export function isSafeString(string: unknown): string is SafeString {
    return isPlainObject(string) && string._tag === safeStringTag;
}
