import {DocumentationOrderedList} from "~/client/web/docs/internal/markdown/components/documentation_ordered_list.js";

test("renders visible decimal markers", () => {
    expect(DocumentationOrderedList({children: "First"})).toMatchObject({
        props: {style: {listStylePosition: "outside", listStyleType: "decimal"}},
    });
});

test("renders numbered list items", () => {
    expect(DocumentationOrderedList.markdown({children: ["First", "Second", "Third"]})).toBe(
        "1. First\n2. Second\n3. Third\n\n",
    );
});

test("numbers items and indents continuation lines under the marker", () => {
    expect(DocumentationOrderedList.markdown({children: ["", "First", "Second\nwrapped"]})).toBe(
        "1. First\n2. Second\n   wrapped\n\n",
    );
});
