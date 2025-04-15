/**
 * Convert a snake_case string into camelCase.
 */
export function convertSnakeCaseToCamelCase(string: string): string {
    return string.replace(/_([a-zA-Z])?/g, (substring, char1) => char1.toUpperCase());
}
