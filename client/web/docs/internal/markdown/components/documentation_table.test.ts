import {DocumentationTable} from "~/client/web/docs/internal/markdown/components/documentation_table.js";

test("renders table children as markdown rows", () => {
    expect(DocumentationTable.markdown({children: ["| A |", "| B |"]})).toBe("| A |\n| B |\n\n");
});

test("drops empty table child entries before joining rows", () => {
    expect(DocumentationTable.markdown({children: ["", "| A |", "  ", "| B |"]})).toBe(
        "| A |\n| B |\n\n",
    );
});
