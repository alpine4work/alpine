import {parseBlogPostDate} from "~/app/docs/codegen/parse_blog_post_date.js";

test("parses a real blog post calendar date", () => {
    expect(
        parseBlogPostDate({
            value: "2024-02-29",
            fieldName: "modifiedDate",
            sourceName: "post.mdx",
        }),
    ).toBe("2024-02-29");
});

test("rejects an impossible blog post calendar date", () => {
    expect(() =>
        parseBlogPostDate({
            value: "2026-02-30",
            fieldName: "modifiedDate",
            sourceName: "post.mdx",
        }),
    ).toThrow("Expected modifiedDate YYYY-MM-DD for post.mdx");
});
