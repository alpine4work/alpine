import {DocumentationListItem} from "~/client/web/docs/internal/markdown/components/documentation_list_item.js";

test("renders list item content", () => {
    expect(DocumentationListItem.markdown({children: "Item"})).toBe("Item");
});

test("trims surrounding whitespace from list item content", () => {
    expect(DocumentationListItem.markdown({children: ["  Item ", 2, "  "]})).toBe("Item 2");
});
