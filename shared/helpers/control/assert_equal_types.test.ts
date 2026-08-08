import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";

test("works with primitive types", () => {
    // @ts-expect-error
    assertEqualTypes<number, string>();

    assertEqualTypes<number, number>();

    assertEqualTypes<string, string>();

    // @ts-expect-error
    assertEqualTypes<42, number>();

    // @ts-expect-error
    assertEqualTypes<number, 42>();

    // @ts-expect-error
    assertEqualTypes<"foo", string>();

    // @ts-expect-error
    assertEqualTypes<string, "foo">();
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
