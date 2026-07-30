import {DocumentationTableCell} from "~/client/web/docs/internal/markdown/components/documentation_table_cell.js";

test("renders table cell content", () => {
    expect(DocumentationTableCell.markdown({children: "value"})).toBe("value");
});

test("trims table cell markdown content", () => {
    expect(DocumentationTableCell.markdown({children: "  value  "})).toBe("value");
});
