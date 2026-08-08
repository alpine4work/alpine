import {
    assertAssignableTypes,
    assertNotAssignableTypes,
} from "~/shared/helpers/control/assert_assignable_types.open_source.js";

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

test("inverse works with primitive types", () => {
    assertNotAssignableTypes<number, string>();

    // @ts-expect-error
    assertNotAssignableTypes<number, number>();

    // @ts-expect-error
    assertNotAssignableTypes<string, string>();

    // @ts-expect-error
    assertNotAssignableTypes<42, number>();

    assertNotAssignableTypes<number, 42>();

    // @ts-expect-error
    assertNotAssignableTypes<"foo", string>();

    assertNotAssignableTypes<string, "foo">();
});

test("inverse works with string unions", () => {
    assertNotAssignableTypes<"a", "b" | "c">();

    assertNotAssignableTypes<"a" | "b", "b" | "c">();

    // @ts-expect-error
    assertNotAssignableTypes<"a" | "b", "a" | "b" | "c">();

    assertNotAssignableTypes<"a" | "b" | "c", "a" | "b">();

    // @ts-expect-error
    assertNotAssignableTypes<"a" | "b" | "c", "a" | "b" | "c">();
});
