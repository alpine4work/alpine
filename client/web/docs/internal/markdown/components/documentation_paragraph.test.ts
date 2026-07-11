import {DocumentationParagraph} from "~/client/web/docs/internal/markdown/components/documentation_paragraph.js";

test("renders paragraph markdown", () => {
    expect(DocumentationParagraph.markdown({children: "Hello world."})).toBe("Hello world.\n\n");
});

test("trims paragraph content before adding paragraph spacing", () => {
    expect(DocumentationParagraph.markdown({children: ["  Body ", 2, "  "]})).toBe("Body 2\n\n");
});
