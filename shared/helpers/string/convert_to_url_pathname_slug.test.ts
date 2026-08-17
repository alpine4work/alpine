import {convertToUrlPathnameSlug} from "~/shared/helpers/string/convert_to_url_pathname_slug.open_source.js";

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
        {input: "!@#$%^&*()", output: "and"},
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

describe("apostrophes", () => {
    const cases = [
        // eslint-disable-next-line cyberworlds/string-quotes
        {input: "Rose's document", output: "roses-document"},
        {input: "Rose\u2019s document", output: "roses-document"},
        // eslint-disable-next-line cyberworlds/string-quotes
        {input: "it's ready", output: "its-ready"},
        {input: "I can\u2019t imagine", output: "i-cant-imagine"},
        // eslint-disable-next-line cyberworlds/string-quotes
        {input: "I can't imagine", output: "i-cant-imagine"},
        {input: "We\u2019re ready", output: "were-ready"},
        // eslint-disable-next-line cyberworlds/string-quotes
        {input: "We're ready", output: "were-ready"},
    ];

    test.each(cases)("converts `$input` to `$output`", ({input, output}) => {
        expect(convertToUrlPathnameSlug(input)).toBe(output);
    });
});

describe("length limit", () => {
    test("truncates at the preceding word boundary", () => {
        expect(
            convertToUrlPathnameSlug(
                "A detailed photograph of a snowy owl with dramatic white feathers spread wide across a moonlit forest",
                "-",
                {limitLength: 50},
            ),
        ).toBe("a-detailed-photograph-of-a-snowy-owl-with");
    });

    test("truncates at the last complete word without removing its final character", () => {
        expect(
            convertToUrlPathnameSlug(
                "Alice in Post Comment Counts: Uncommented roadmap summary",
                "-",
                {limitLength: 50},
            ),
        ).toBe("alice-in-post-comment-counts-uncommented-roadmap");
    });

    test("truncates within an unusually long word to enforce the length limit", () => {
        const slug = convertToUrlPathnameSlug("Prefix abcdefghijklmnopqrstuvwxyz", "-", {
            limitLength: 22,
        });

        expect(slug).toBe("prefix-abcdefghijklmno");
        expect(slug).toHaveLength(22);
    });
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
