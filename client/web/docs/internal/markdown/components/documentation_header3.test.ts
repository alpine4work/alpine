import {DocumentationHeader3} from "~/client/web/docs/internal/markdown/components/documentation_header3.js";

test("renders a level three heading", () => {
    expect(DocumentationHeader3.markdown({children: "Details"})).toBe("### Details\n\n");
});

test("flattens heading children before rendering level three markdown", () => {
    expect(DocumentationHeader3.markdown({children: ["Detail ", 3, false]})).toBe(
        "### Detail 3\n\n",
    );
});
