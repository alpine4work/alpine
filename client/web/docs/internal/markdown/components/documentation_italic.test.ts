import {DocumentationItalic} from "~/client/web/docs/internal/markdown/components/documentation_italic.js";

test("renders italic markdown", () => {
    expect(DocumentationItalic.markdown({children: "Important"})).toBe("*Important*");
});

test("flattens non-string children into italic markdown", () => {
    expect(DocumentationItalic.markdown({children: ["item ", 1, null]})).toBe("*item 1*");
});
