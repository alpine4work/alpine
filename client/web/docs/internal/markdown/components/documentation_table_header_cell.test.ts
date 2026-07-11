import {DocumentationTableHeaderCell} from "~/client/web/docs/internal/markdown/components/documentation_table_header_cell.js";

test("renders table header cell content", () => {
    expect(DocumentationTableHeaderCell.markdown({children: "Field"})).toBe("Field");
});

test("trims table header cell markdown content", () => {
    expect(DocumentationTableHeaderCell.markdown({children: "  Field  "})).toBe("Field");
});
