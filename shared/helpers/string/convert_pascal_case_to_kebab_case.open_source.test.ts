import {convertPascalCaseToKebabCase} from "~/shared/helpers/string/convert_pascal_case_to_kebab_case.open_source.js";

const cases = [
    {input: "AccountTaskId", output: "account-task-id"},
    {input: "Value2Display", output: "value2-display"},
    {input: "Single", output: "single"},
    {input: "X", output: "x"},
    {input: "", output: ""},
];

for (const {input, output} of cases) {
    test(`converts \`${input}\` to \`${output}\``, () => {
        expect(convertPascalCaseToKebabCase(input)).toBe(output);
    });
}
