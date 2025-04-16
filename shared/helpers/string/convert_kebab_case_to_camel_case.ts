/**
 * Convert a kebab-case string into camelCase.
 */
export function convertKebabCaseToCamelCase(string: string): string {
    return string.replace(/-([a-zA-Z])?/g, (substring, char1) => char1.toUpperCase());
}
