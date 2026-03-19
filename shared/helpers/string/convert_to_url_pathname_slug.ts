import removeAccents from "remove-accents";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";

/**
 * Convert an arbitrary string to an alphanumeric slug for use in URLs. All
 * non-alphanumeric characters are stripped and replaced by the provided separator.
 *
 * If `allowedCharacters` is provided, then those characters are also allowed in
 * the slug.
 */
export function convertToUrlPathnameSlug(
    string: string,
    separator: string = "-",
    {allowedCharacters = emptySet}: {allowedCharacters?: ReadonlySet<string>} = emptyObject,
): string {
    // Remove diacritics from the string and replace with the ASCII alternative. So
    // "Rose Compás" becomes "Rose Compas".
    string = removeAccents(string);

    // Convert the string to lowercase.
    string = string.toLowerCase();

    const oldString = string;
    string = "";

    let separatorState: "Character" | "NeedsSeparator" | null = null;

    for (const character of oldString) {
        if (/^[a-z0-9]$/.test(character) || allowedCharacters.has(character)) {
            if (separatorState === "NeedsSeparator") string += separator;
            string += character;
            separatorState = "Character";
        } else {
            if (separatorState === "Character") separatorState = "NeedsSeparator";
        }
    }

    return string;
}
