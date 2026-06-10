type SemicolonSeparatedHeaderParameter = {name: string; value: string};

/** Synthetic `name` for the token before the first `;` in the header value. */
export const semicolonSeparatedHeaderLeadingTokenParameterName = "leadingToken";

/**
 * Parses semicolon-separated parameters from a Content-Disposition or Content-Type
 * style header values. Handles quoted values and backslash escapes inside quotes
 * and leaves encoded values as-is.
 *
 * The first entry is always
 * `{ name: "leadingToken", value: "<token before first ;>" }`. Remaining entries
 * are normal `name=value` parameters (`name` lowercased).
 *
 * For example:
 *
 * `attachment; filename="foo"; size=123`
 *
 * parses to:
 *
 * `[{name: "leadingToken", value: "attachment"}, {name: "filename", value: "foo"}, {name: "size", value: "123"}]`
 */
export function parseSemicolonSeparatedHeaderParameters(
    headerValue: string,
): Array<SemicolonSeparatedHeaderParameter> {
    const parameters: Array<SemicolonSeparatedHeaderParameter> = [];
    const firstSemicolon = headerValue.indexOf(";");
    if (firstSemicolon === -1) {
        return [
            {name: semicolonSeparatedHeaderLeadingTokenParameterName, value: headerValue.trim()},
        ];
    }
    const primaryToken = headerValue.slice(0, firstSemicolon).trim();
    let index = firstSemicolon + 1;
    while (index < headerValue.length) {
        // Skip any whitespace characters.
        while (index < headerValue.length && /\s/.test(headerValue.charAt(index))) {
            index++;
        }
        const equalSign = headerValue.indexOf("=", index);
        if (equalSign === -1) {
            break;
        }
        const name = headerValue.slice(index, equalSign).trim().toLowerCase();
        index = equalSign + 1;

        // Skip any whitespace characters.
        while (index < headerValue.length && /\s/.test(headerValue.charAt(index))) {
            index++;
        }
        let value: string;
        // If the character is a double quote, loop through the characters until we reach
        // the end of the value.
        if (headerValue.charCodeAt(index) === 0x22) {
            index++;
            const start = index;
            while (index < headerValue.length) {
                const code = headerValue.charCodeAt(index);
                // If the character is a backslash, skip the next character and continue since it
                // is an escape character.
                if (code === 0x5c && index + 1 < headerValue.length) {
                    index += 2;
                    continue;
                }
                // If the character is a double quote, we've reached the end of the value.
                if (code === 0x22) {
                    break;
                }
                index++;
            }
            value = headerValue.slice(start, index);
            index++;
        } else {
            const semicolon = headerValue.indexOf(";", index);
            const end = semicolon === -1 ? headerValue.length : semicolon;
            value = headerValue.slice(index, end).trim();
            index = end;
        }
        parameters.push({name, value});
        if (index < headerValue.length && headerValue[index] === ";") {
            index++;
        }
    }
    return [
        {name: semicolonSeparatedHeaderLeadingTokenParameterName, value: primaryToken},
        ...parameters,
    ];
}
