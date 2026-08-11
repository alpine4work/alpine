/**
 * Parses a string as a checkbox value. Match is on a trimmed, lower-cased input
 * against {@link checkboxFalseStrings}. Empty (whitespace only) input is also
 * `false`. Anything else is `true`. These permissive rules let paste and import
 * paths accept common checkbox representations.
 */
export function parseDatabaseCheckboxFieldValueString(input: string): boolean {
    return !checkboxFalseStrings.has(input.trim().toLowerCase());
}

/**
 * Strings interpreted as `false` by `parseDatabaseCheckboxFieldValueString`.
 */
const checkboxFalseStrings: ReadonlySet<string> = new Set([
    "",
    "0",
    "f",
    "false",
    "n",
    "no",
    "off",
    "unchecked",
    "✗",
    "✘",
    "☐",
]);
