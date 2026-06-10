import {convertPascalCaseToKebabCase} from "~/shared/helpers/string/convert_pascal_case_to_kebab_case.js";

const cases = [
    {input: "AccountTaskId", output: "account-task-id"},
    {input: "Value2Display", output: "value2-display"},
    {input: "Single", output: "single"},
    {input: "X", output: "x"},
    {input: "", output: ""},
];

test.each(cases)("converts `$input` to `$output`", ({input, output}) => {
    expect(convertPascalCaseToKebabCase(input)).toBe(output);
});
