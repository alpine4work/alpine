import {convertSnakeCaseToPascalCase} from "~/shared/helpers/string/convert_snake_case_to_pascal_case.js";

const cases = [
    {input: "account_task_id", output: "AccountTaskId"},
    {input: "simple_value", output: "SimpleValue"},
    {input: "single", output: "Single"},
    {input: "", output: ""},
];

test.each(cases)("converts `$input` to `$output`", ({input, output}) => {
    expect(convertSnakeCaseToPascalCase(input)).toBe(output);
});
