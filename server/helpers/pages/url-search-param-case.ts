const urlSearchParamCaseRegExp = /^[a-z]([a-z0-9-]*[a-z0-9]|)$/;

/**
 * Is the provided string the correct case for a URL search param?
 *
 * URL search params are `kebab-case`. All lowercase letters with words
 * separated by a hyphen. Can not end with a hyphen.
 */
export function isUrlSearchParamCase(string: string): boolean {
    return urlSearchParamCaseRegExp.test(string);
}

/**
 * Convert a string in URL search param case to a camel case identifier.
 *
 * If the input string passes `isUrlSearchParamCase()` then the output string
 * should pass `isIdentifier()`.
 */
export function convertUrlSearchParamCaseToIdentifier(string: string): string {
    return string.replaceAll(/-([a-z]?)/g, (match, letter) => letter.toUpperCase());
}
