import {convertToUrlPathnameSlug} from "~/shared/helpers/string/convert_to_url_pathname_slug.js";

describe("default separator", () => {
    const cases = [
        {input: "Rose Compás", output: "rose-compas"},
        {input: "Crème brûlée à la mode", output: "creme-brulee-a-la-mode"},
        {input: "Hello, World!", output: "hello-world"},
        {input: "___alpha---beta___", output: "alpha-beta"},
        {input: "   Multiple    Spaces   ", output: "multiple-spaces"},
        {input: "Task 123 Version 2", output: "task-123-version-2"},
        {input: "already-a-slug", output: "already-a-slug"},
        {input: "foo_bar/baz", output: "foo-bar-baz"},
        {input: "!@#$%^&*()", output: ""},
        {input: "東京", output: ""},
        {input: "", output: ""},
    ];

    test.each(cases)("converts `$input` to `$output`", ({input, output}) => {
        expect(convertToUrlPathnameSlug(input)).toBe(output);
    });
});

describe("custom separator", () => {
    const cases = [
        {input: "Hello World", separator: "_", output: "hello_world"},
        {input: "a---b", separator: "__", output: "a__b"},
        {input: "  a b  ", separator: "/", output: "a/b"},
        {input: "a b", separator: "", output: "ab"},
    ];

    test.each(cases)(
        "converts `$input` with `$separator` to `$output`",
        ({input, separator, output}) => {
            expect(convertToUrlPathnameSlug(input, separator)).toBe(output);
        },
    );
});

describe("allowed characters", () => {
    test("preserves explicitly allowed characters", () => {
        expect(
            convertToUrlPathnameSlug("Version 1.2.3 (beta)", "-", {
                allowedCharacters: new Set(["."]),
            }),
        ).toBe("version-1.2.3-beta");
    });

    test("preserves multiple explicitly allowed characters", () => {
        expect(
            convertToUrlPathnameSlug("foo@bar+baz", "-", {
                allowedCharacters: new Set(["@", "+"]),
            }),
        ).toBe("foo@bar+baz");
    });

    test("still inserts separators for disallowed characters between allowed characters", () => {
        expect(
            convertToUrlPathnameSlug("a! ?b", "-", {
                allowedCharacters: new Set(["!"]),
            }),
        ).toBe("a!-b");
    });

    test("works with custom separator and allowed characters together", () => {
        expect(
            convertToUrlPathnameSlug("Feature: v2.1 release", "_", {
                allowedCharacters: new Set([".", ":"]),
            }),
        ).toBe("feature:_v2.1_release");
    });
});
