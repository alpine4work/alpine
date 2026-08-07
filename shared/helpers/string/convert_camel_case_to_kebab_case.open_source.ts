/**
 * Convert a camelCase string into kebab-case.
 */
export function convertCamelCaseToKebabCase(string: string): string {
    return string
        .replace(/([a-zA-Z0-9]?)([A-Z])/g, (substring, char1, char2) =>
            char1.length > 0 ? `${char1}-${char2.toLowerCase()}` : char2.toLowerCase(),
        )
        .replace(/_/g, "-");
}
