import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types";

test("works with primitive types", () => {
    // @ts-expect-error
    assertEqualTypes<number, string>();

    assertEqualTypes<number, number>();

    assertEqualTypes<string, string>();
});

test("works with string unions", () => {
    // @ts-expect-error
    assertEqualTypes<"a", "b" | "c">();

    // @ts-expect-error
    assertEqualTypes<"a" | "b", "b" | "c">();

    // @ts-expect-error
    assertEqualTypes<"a" | "b", "a" | "b" | "c">();

    // @ts-expect-error
    assertEqualTypes<"a" | "b" | "c", "a" | "b">();

    assertEqualTypes<"a" | "b" | "c", "a" | "b" | "c">();
});
