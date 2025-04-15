/**
 * Convert a camelCase string into snake_case.
 */
export function convertCamelCaseToSnakeCase(string: string): string {
    return string
        .replace(/([a-zA-Z0-9]?)([A-Z])/g, (substring, char1, char2) =>
            char1.length > 0 ? `${char1}_${char2.toLowerCase()}` : char2.toLowerCase(),
        )
        .replace(/-/g, "_");
}
