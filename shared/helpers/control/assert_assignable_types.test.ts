import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";

test("works with primitive types", () => {
    // @ts-expect-error
    assertAssignableTypes<number, string>();

    assertAssignableTypes<number, number>();

    assertAssignableTypes<string, string>();

    assertAssignableTypes<42, number>();

    // @ts-expect-error
    assertAssignableTypes<number, 42>();

    assertAssignableTypes<"foo", string>();

    // @ts-expect-error
    assertAssignableTypes<string, "foo">();
});

test("works with string unions", () => {
    // @ts-expect-error
    assertAssignableTypes<"a", "b" | "c">();

    // @ts-expect-error
    assertAssignableTypes<"a" | "b", "b" | "c">();

    assertAssignableTypes<"a" | "b", "a" | "b" | "c">();

    // @ts-expect-error
    assertAssignableTypes<"a" | "b" | "c", "a" | "b">();

    assertAssignableTypes<"a" | "b" | "c", "a" | "b" | "c">();
});
