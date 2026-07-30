import {DocumentationBlockquote} from "~/client/web/docs/internal/markdown/components/documentation_blockquote.js";

test("renders a simple blockquote", () => {
    expect(DocumentationBlockquote.markdown({children: "Quoted"})).toBe("> Quoted\n\n");
});

test("quotes blank lines inside trimmed content", () => {
    expect(DocumentationBlockquote.markdown({children: "  First\n\nSecond  "})).toBe(
        "> First\n>\n> Second\n\n",
    );
});
