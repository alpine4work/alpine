import {assert} from "~/shared/helpers/control/assert.js";

/**
 * A template string tag that wraps all the interpolated string values in
 * quotes to make sure they don't interfere with the rest of the string.
 *
 * This is useful for error messages where you want to include some dynamic
 * data.
 */
export function quote(
    templateStrings: TemplateStringsArray,
    ...values: Array<string | number | boolean | null>
): string {
    assert(templateStrings.length > 0);
    assert(templateStrings.length === values.length + 1);

    let string = "";

    for (let i = 0; i < templateStrings.length; i++) {
        if (i !== 0) {
            string += JSON.stringify(values[i - 1]);
        }
        string += templateStrings[i];
    }

    return string;
}
