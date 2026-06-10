import {convertCamelCaseToSnakeCase} from "~/shared/helpers/string/convert_camel_case_to_snake_case.js";

/**
 * Convert a PascalCase string into snake_case.
 */
export function convertPascalCaseToSnakeCase(string: string): string {
    string = (string[0] ?? "").toLowerCase() + string.slice(1);
    return convertCamelCaseToSnakeCase(string);
}
