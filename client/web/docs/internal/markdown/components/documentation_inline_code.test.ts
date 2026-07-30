import {DocumentationInlineCode} from "~/client/web/docs/internal/markdown/components/documentation_inline_code.js";

test("renders inline code without a language class", () => {
    expect(DocumentationInlineCode.markdown({children: "npm test"})).toBe("`npm test`");
});

test("trims trailing newlines from language code fences", () => {
    expect(
        DocumentationInlineCode.markdown({
            className: "language-ts",
            children: "const value = 1;\n\n",
        }),
    ).toBe("```ts\nconst value = 1;\n```\n\n");
});
