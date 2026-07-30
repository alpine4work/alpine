import {DocumentationTableBody} from "~/client/web/docs/internal/markdown/components/documentation_table_body.js";

test("renders table body rows", () => {
    expect(DocumentationTableBody.markdown({children: ["| A |", "| B |"]})).toBe("| A |\n| B |");
});

test("joins non-empty table body rows", () => {
    expect(DocumentationTableBody.markdown({children: ["| A |", "", "| B |"]})).toBe(
        "| A |\n| B |",
    );
});
