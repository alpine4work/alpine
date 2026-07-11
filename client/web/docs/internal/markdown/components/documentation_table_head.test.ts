import {DocumentationTableHead} from "~/client/web/docs/internal/markdown/components/documentation_table_head.js";

test("renders a header row with a separator", () => {
    expect(DocumentationTableHead.markdown({children: "| A | B |"})).toBe(
        "| A | B |\n| --- | --- |",
    );
});

test("sizes the separator row from the first header row", () => {
    expect(DocumentationTableHead.markdown({children: "| A | B | C |"})).toBe(
        "| A | B | C |\n| --- | --- | --- |",
    );
});
