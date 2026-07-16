import {DocumentationStrikethrough} from "~/client/web/docs/internal/markdown/components/documentation_strikethrough.js";

test("renders strikethrough markdown", () => {
    expect(DocumentationStrikethrough.markdown({children: "gone"})).toBe("~~gone~~");
});

test("flattens children before wrapping strikethrough markdown", () => {
    expect(DocumentationStrikethrough.markdown({children: ["gone", false]})).toBe("~~gone~~");
});
