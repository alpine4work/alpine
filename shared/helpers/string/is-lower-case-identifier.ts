const lowerCaseIdentifierRegexp = /^[a-z_][a-z0-9_]*$/;

/**
 * Is the provided string a valid lower case ASCII identifier?
 *
 * A valid ASCII identifier is:
 *
 * - Not empty
 * - Starts with an ASCII letter or underscore (`_`)
 * - Contains only ASCII letters, numbers, or underscores (`_`)
 */
export function isLowerCaseIdentifier(string: string): boolean {
    return lowerCaseIdentifierRegexp.test(string);
}
