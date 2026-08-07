import {assert} from "~/shared/helpers/control/assert.open_source.js";

/**
 * A template string tag that wraps all the interpolated string values in quotes to
 * make sure they don't interfere with the rest of the string.
 *
 * This is useful for error messages where you want to include some dynamic data.
 *
 * You can also call the function with a single string like `quote("foo")` to wrap
 * the string in quotes and escape any quotes within the string.
 *
 * The string is escaped to make sure it's valid Markdown. So it's safe to
 * interpolate the result of this function into a Markdown string.
 */
export function quote(string: string | number | bigint): string;
export function quote(
    templateStrings: TemplateStringsArray,
    ...values: Array<string | number | bigint | boolean | null | undefined>
): string;
export function quote(
    templateStrings: TemplateStringsArray | string | number | bigint,
    ...values: Array<string | number | bigint | boolean | null | undefined>
): string {
    if (typeof templateStrings === "number") {
        return JSON.stringify(templateStrings);
    }
    if (typeof templateStrings === "bigint") {
        return String(templateStrings);
    }
    if (typeof templateStrings === "string") {
        return quoteValue(templateStrings);
    }

    assert(templateStrings.length > 0);
    assert(templateStrings.length === values.length + 1);

    let string = "";

    for (let i = 0; i < templateStrings.length; i++) {
        if (i !== 0) {
            const value = values[i - 1];

            let quotedString =
                typeof value === "bigint"
                    ? String(value)
                    : JSON.stringify(value === undefined ? null : value);

            // Quote a string with backticks instead of straight quotes. We'd rather use
            // backticks than curl quotes (given our lint rule disallows the use of straight
            // quotes elsewhere in strings).
            if (typeof value === "string") {
                quotedString = quoteValue(value);
            }

            string += quotedString;
        }
        string += templateStrings[i];
    }

    return string;
}

/**
 * Quote a string using Markdown inline code syntax. Escapes using the same
 * procedure as `mdast-util-to-markdown` which we use to print markdown across our
 * codebase.
 */
function quoteValue(value: string) {
    // Fun fact: an empty code span is unrepresentable in CommonMark since two epeated
    // backticks are interpreted as a single run of length 2. So we use the special
    // string "empty" instead.
    if (value.length === 0) return "empty";

    // Escapes a bunch of characters like `\n`. Except we don't want to escape string
    // double quotes! Those are totally ok in Markdown inline code.
    //
    // eslint-disable-next-line cyberworlds/string-quotes
    value = JSON.stringify(value).slice(1, -1).replaceAll('\\"', '"');

    let sequence = "`";

    while (new RegExp(`(^|[^\`])${sequence}([^\`]|$)`).test(value)) {
        sequence += "`";
    }

    if (/[^ ]/.test(value) && ((/^ /.test(value) && / $/.test(value)) || /^`|`$/.test(value))) {
        value = ` ${value} `;
    }

    return sequence + value + sequence;
}
