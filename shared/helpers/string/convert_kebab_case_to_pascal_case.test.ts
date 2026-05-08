import {convertKebabCaseToPascalCase} from "~/shared/helpers/string/convert_kebab_case_to_pascal_case.js";

const cases = [
    {input: "account-task-id", output: "AccountTaskId"},
    {input: "simple-value", output: "SimpleValue"},
    {input: "single", output: "Single"},
    {input: "", output: ""},
];

test.each(cases)("converts `$input` to `$output`", ({input, output}) => {
    expect(convertKebabCaseToPascalCase(input)).toBe(output);
});
