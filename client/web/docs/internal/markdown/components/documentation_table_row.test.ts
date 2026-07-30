import {DocumentationTableRow} from "~/client/web/docs/internal/markdown/components/documentation_table_row.js";

test("renders table row cells", () => {
    expect(DocumentationTableRow.markdown({children: ["A", "B"]})).toBe("| A | B |");
});

test("escapes pipe characters inside table cells", () => {
    expect(DocumentationTableRow.markdown({children: ["A | B", "C"]})).toBe("| A \\| B | C |");
});
