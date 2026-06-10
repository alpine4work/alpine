import {convertSnakeCaseToCamelCase} from "~/shared/helpers/string/convert_snake_case_to_camel_case.js";

const cases = [
    {input: "account_task_id", output: "accountTaskId"},
    {input: "simple_value", output: "simpleValue"},
    {input: "single", output: "single"},
    {input: "", output: ""},
];

test.each(cases)("converts `$input` to `$output`", ({input, output}) => {
    expect(convertSnakeCaseToCamelCase(input)).toBe(output);
});
