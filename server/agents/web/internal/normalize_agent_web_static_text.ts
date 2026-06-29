import {stemmer} from "stemmer";
import {convertCamelCaseToKebabCase} from "~/shared/helpers/string/convert_camel_case_to_kebab_case.js";

/**
 * Normalizes static text strings we check for in agent web markdown. Gives the
 * agent some wiggle room when writing text to pluralize or case words differently
 * then we might otherwise.
 *
 * - Case insensitive
 * - Understands `camelCase`, `PascalCase`, `kebab-case`, and `snake_case`
 * - Stems individual words (e.g. `documents` -> `document`)
 */
export function normalizeAgentWebStaticText(text: string): string {
    // Convert `camelCase` and `PascalCase` to `kebab-case`.
    text = convertCamelCaseToKebabCase(text);

    // Normalize word separators to hyphens.
    text = text.replaceAll(/[_ ]/g, "-");

    // Replace runs with multiple hyphens with a single hyphen.
    text = text.replaceAll(/-{2,}/g, "-");

    // Replace leading/trailing hyphens (also whitespace).
    text = text.replaceAll(/^-+/g, "");
    text = text.replaceAll(/-+$/g, "");

    // Remove apostrophe "'s" so "it's" and "Rose's" become "its" and "Roses".
    text = text.replaceAll(/(?<=[^\s])[\u2019\u0027]s/g, "s");

    // Convert to lowercase so we're case insensitive.
    text = text.toLowerCase();

    // Stem each individual word.
    text = text
        .split("-")
        .map(word => stemmer(word))
        .join("-");

    return text;
}
