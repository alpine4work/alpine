import {InvalidArgumentError} from "~/shared/error/error.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";

test("empty strings are not valid", () => {
    expect(() => LabelStringSchema.serialize("")).toThrow(InvalidArgumentError);
});

test("empty space strings are not valid", () => {
    expect(() => LabelStringSchema.serialize(" ")).toThrow(InvalidArgumentError);
});

test("empty new line strings are not valid", () => {
    expect(() => LabelStringSchema.serialize("\n")).toThrow(InvalidArgumentError);
});
