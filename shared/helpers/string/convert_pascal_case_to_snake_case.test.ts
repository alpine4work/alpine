import {convertPascalCaseToSnakeCase} from "~/shared/helpers/string/convert_pascal_case_to_snake_case.js";

const cases = [
    {input: "AccountTaskId", output: "account_task_id"},
    {input: "Value2Display", output: "value2_display"},
    {input: "Single", output: "single"},
    {input: "X", output: "x"},
    {input: "", output: ""},
];

test.each(cases)("converts `$input` to `$output`", ({input, output}) => {
    expect(convertPascalCaseToSnakeCase(input)).toBe(output);
});
