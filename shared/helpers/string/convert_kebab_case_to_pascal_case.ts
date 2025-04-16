import {convertKebabCaseToCamelCase} from "~/shared/helpers/string/convert_kebab_case_to_camel_case.js";

/**
 * Convert a snake_case string into PascalCase.
 */
export function convertKebabCaseToPascalCase(string: string): string {
    string = convertKebabCaseToCamelCase(string);
    return (string[0] ?? "").toUpperCase() + string.slice(1);
}
