import {convertSnakeCaseToCamelCase} from "~/shared/helpers/string/convert_snake_case_to_camel_case.js";

/**
 * Convert a snake_case string into PascalCase.
 */
export function convertSnakeCaseToPascalCase(string: string): string {
    string = convertSnakeCaseToCamelCase(string);
    return (string[0] ?? "").toUpperCase() + string.slice(1);
}
