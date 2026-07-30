import {DocumentationCardGrid} from "~/client/web/docs/internal/markdown/components/documentation_card_grid.js";

test("renders card children as a markdown list", () => {
    expect(DocumentationCardGrid.markdown({children: ["- One", "- Two"]})).toBe("- One\n- Two\n\n");
});

test("drops empty child entries before joining card markdown", () => {
    expect(DocumentationCardGrid.markdown({children: ["", "- One", "\n", "- Two"]})).toBe(
        "- One\n- Two\n\n",
    );
});
