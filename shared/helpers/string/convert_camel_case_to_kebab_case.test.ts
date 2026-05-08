import {convertCamelCaseToKebabCase} from "~/shared/helpers/string/convert_camel_case_to_kebab_case.js";

const cases = [
    {input: "accountTaskId", output: "account-task-id"},
    {input: "value2Display", output: "value2-display"},
    {input: "single", output: "single"},
    {input: "already_snake_case", output: "already-snake-case"},
    {input: "", output: ""},
];

test.each(cases)("converts `$input` to `$output`", ({input, output}) => {
    expect(convertCamelCaseToKebabCase(input)).toBe(output);
});
