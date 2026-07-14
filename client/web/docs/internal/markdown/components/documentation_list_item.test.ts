import {DocumentationListItem} from "~/client/web/docs/internal/markdown/components/documentation_list_item.js";

test("adds space between rendered list items", () => {
    expect(DocumentationListItem({children: "Item"})).toMatchObject({
        props: {marginBottom: "1.5"},
    });
});

test("renders list item content", () => {
    expect(DocumentationListItem.markdown({children: "Item"})).toBe("Item");
});

test("trims surrounding whitespace from list item content", () => {
    expect(DocumentationListItem.markdown({children: ["  Item ", 2, "  "]})).toBe("Item 2");
});
