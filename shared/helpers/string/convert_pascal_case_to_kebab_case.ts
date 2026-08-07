import {convertCamelCaseToKebabCase} from "~/shared/helpers/string/convert_camel_case_to_kebab_case.open_source.js";

/**
 * Convert a PascalCase string into kebab-case.
 */
export function convertPascalCaseToKebabCase(string: string): string {
    string = (string[0] ?? "").toLowerCase() + string.slice(1);
    return convertCamelCaseToKebabCase(string);
}
