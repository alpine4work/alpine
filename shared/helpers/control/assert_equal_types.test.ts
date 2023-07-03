import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";

test("works with primitive types", () => {
    // @ts-expect-error
    assertEqualTypes<number, string>();

    assertEqualTypes<number, number>();

    assertEqualTypes<string, string>();

    // @ts-expect-error
    assertAssignableTypes<42, number>();

    // @ts-expect-error
    assertAssignableTypes<number, 42>();

    // @ts-expect-error
    assertAssignableTypes<"foo", string>();

    // @ts-expect-error
    assertAssignableTypes<string, "foo">();
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
