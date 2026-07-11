import {DocumentationHeader2} from "~/client/web/docs/internal/markdown/components/documentation_header2.js";

test("renders a level two heading", () => {
    expect(DocumentationHeader2.markdown({children: "Anatomy"})).toBe("## Anatomy\n\n");
});

test("flattens heading children before rendering level two markdown", () => {
    expect(DocumentationHeader2.markdown({children: ["Section ", 2, false]})).toBe(
        "## Section 2\n\n",
    );
});
