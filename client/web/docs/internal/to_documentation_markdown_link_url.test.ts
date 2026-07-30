import {toDocumentationMarkdownLinkUrl} from "~/client/web/docs/internal/to_documentation_markdown_link_url.js";

test("appends .md to an internal docs page link", () => {
    expect(toDocumentationMarkdownLinkUrl("/docs/guides/tasks")).toBe("/docs/guides/tasks.md");
});

test("aliases the docs home to the overview markdown", () => {
    expect(toDocumentationMarkdownLinkUrl("/docs")).toBe("/docs.md");
});

test("keeps an in-page anchor on the markdown link", () => {
    expect(toDocumentationMarkdownLinkUrl("/docs/api/schemas/Task#properties")).toBe(
        "/docs/api/schemas/Task.md#properties",
    );
});

test("leaves an external link unchanged", () => {
    expect(toDocumentationMarkdownLinkUrl("https://alpine.inc")).toBe("https://alpine.inc");
});

test("does not double up an existing .md link", () => {
    expect(toDocumentationMarkdownLinkUrl("/docs/guides/tasks.md")).toBe("/docs/guides/tasks.md");
});
