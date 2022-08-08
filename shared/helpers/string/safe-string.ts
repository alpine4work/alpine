import {assert} from "~/shared/helpers/control/assert";
import {isPlainObject} from "~/shared/helpers/object/is-plain-object";

const safeStringTag = Symbol("safe");

/**
 * A safe string that does not include user input.
 *
 * This helper can be used to prevent injection attacks like SQL injection or
 * XSS. Although we have a separate helper specifically designed for SQL.
 *
 * We have both type system and runtime protections against user input finding
 * its way into a safe string. Even if an attacker is able to inject an
 * arbitrary JSON value into a safe string, we are still able to reject it.
 *
 * If you’re using `dangerouslySetInnerHTML` in React then consider using a safe
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
 * Checks that the parameter is, indeed, a safe string.
 */
export function isSafeString(string: unknown): string is SafeString {
    return isPlainObject(string) && string._tag === safeStringTag;
}
