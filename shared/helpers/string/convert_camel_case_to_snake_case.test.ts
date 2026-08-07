import {convertCamelCaseToSnakeCase} from "~/shared/helpers/string/convert_camel_case_to_snake_case.open_source.js";

const cases = [
    {input: "accountTaskId", output: "account_task_id"},
    {input: "value2Display", output: "value2_display"},
    {input: "single", output: "single"},
    {input: "already-kebab-case", output: "already_kebab_case"},
    {input: "", output: ""},
];

test.each(cases)("converts `$input` to `$output`", ({input, output}) => {
    expect(convertCamelCaseToSnakeCase(input)).toBe(output);
});
