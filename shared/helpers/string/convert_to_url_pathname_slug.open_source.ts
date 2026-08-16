import removeAccents from "remove-accents";
import {emptyObject} from "~/shared/helpers/object/empty_object.open_source.js";
import {emptySet} from "~/shared/helpers/set/empty_set.open_source.js";
import {maxReasonableEnglishWordGraphemeCount} from "~/shared/helpers/string/max_reasonable_english_word_grapheme_count.open_source.js";

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
    {
        limitLength = null,
        allowedCharacters = emptySet,
    }: {
        limitLength?: number | null;
        allowedCharacters?: ReadonlySet<string>;
    } = emptyObject,
): string {
    // Remove diacritics from the string and replace with the ASCII alternative. So
    // "Rose Compás" becomes "Rose Compas".
    string = removeAccents(string);

    // Remove apostrophe "'s" so "it's" and "Rose's" become "its" and "Roses".
    string = string.replaceAll(/(?<=[^\s])[\u2019\u0027]s/g, "s");

    // Replace ampersands with "and" so `D&D` becomes `d-and-d` instead of `d-d`.
    string = string.replaceAll("&", " and ");

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

    // When `limitLength` is set, truncate at the nearest word if the nearest word
    // isn't too long.
    if (limitLength !== null && string.length > limitLength) {
        const limitedString = string.slice(0, limitLength);
        const lastSeparatorIndex = limitedString.lastIndexOf(separator);

        if (
            lastSeparatorIndex === -1 ||
            limitedString.length - lastSeparatorIndex - 1 > maxReasonableEnglishWordGraphemeCount
        ) {
            string = limitedString;
        } else {
            string = limitedString.slice(0, lastSeparatorIndex);
        }
    }

    return string;
}
