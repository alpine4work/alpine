import {InvalidArgumentError} from "~/shared/error/error";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";

test("empty strings are not valid", () => {
    expect(() => LabelStringSchema.serialize("")).toThrow(InvalidArgumentError);
});

test("empty space strings are not valid", () => {
    expect(() => LabelStringSchema.serialize(" ")).toThrow(InvalidArgumentError);
});

test("empty new line strings are not valid", () => {
    expect(() => LabelStringSchema.serialize("\n")).toThrow(InvalidArgumentError);
});
