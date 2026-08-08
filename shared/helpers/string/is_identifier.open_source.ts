export const identifierRegExp = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Is the provided string a valid ASCII identifier?
 *
 * A valid ASCII identifier is:
 *
 * - Not empty
 * - Starts with an ASCII letter or underscore (`_`)
 * - Contains only ASCII letters, numbers, or underscores (`_`)
 */
export function isIdentifier(string: string): boolean {
    return identifierRegExp.test(string);
}
