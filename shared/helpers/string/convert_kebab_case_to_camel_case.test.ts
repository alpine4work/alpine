import {convertKebabCaseToCamelCase} from "~/shared/helpers/string/convert_kebab_case_to_camel_case.js";

const cases = [
    {input: "account-task-id", output: "accountTaskId"},
    {input: "simple-value", output: "simpleValue"},
    {input: "single", output: "single"},
    {input: "", output: ""},
];

test.each(cases)("converts `$input` to `$output`", ({input, output}) => {
    expect(convertKebabCaseToCamelCase(input)).toBe(output);
});
