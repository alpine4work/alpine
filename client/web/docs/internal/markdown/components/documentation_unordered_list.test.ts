import {DocumentationUnorderedList} from "~/client/web/docs/internal/markdown/components/documentation_unordered_list.js";

test("renders visible disc markers", () => {
    expect(DocumentationUnorderedList({children: "First"})).toMatchObject({
        props: {style: {listStylePosition: "outside", listStyleType: "disc"}},
    });
});

test("renders bulleted list items", () => {
    expect(DocumentationUnorderedList.markdown({children: ["First", "Second"]})).toBe(
        "- First\n- Second\n\n",
    );
});

test("bullets items and indents continuation lines under the marker", () => {
    expect(DocumentationUnorderedList.markdown({children: ["First", "Second\nwrapped"]})).toBe(
        "- First\n- Second\n  wrapped\n\n",
    );
});
