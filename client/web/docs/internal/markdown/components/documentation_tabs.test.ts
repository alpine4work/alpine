import {DocumentationTabs} from "~/client/web/docs/internal/markdown/components/documentation_tabs.js";

test("renders tab sections with blank lines between them", () => {
    expect(DocumentationTabs.markdown({children: ["#### A\n\nBody", "#### B\n\nBody"]})).toBe(
        "#### A\n\nBody\n\n#### B\n\nBody\n\n",
    );
});

test("drops empty tab children before joining tab sections", () => {
    expect(DocumentationTabs.markdown({children: ["", "#### A\n\nBody", "#### B\n\nBody"]})).toBe(
        "#### A\n\nBody\n\n#### B\n\nBody\n\n",
    );
});
