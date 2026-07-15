import {assert} from "~/shared/helpers/control/assert.js";

/**
 * A template string tag that wraps all the interpolated string values in quotes to
 * make sure they don't interfere with the rest of the string.
 *
 * This is useful for error messages where you want to include some dynamic data.
 *
 * You can also call the function with a single string like `quote("foo")` to wrap
 * the string in quotes and escape any quotes within the string.
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
                quotedString = quoteValue(quotedString);
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
function quoteValue(quoted: string) {
    quoted = quoted.replaceAll("`", "\\`");
    // eslint-disable-next-line cyberworlds/string-quotes
    quoted = quoted.replaceAll('\\"', '"');
    quoted = `\`${quoted.slice(1, -1)}\``;
    return quoted;
}
