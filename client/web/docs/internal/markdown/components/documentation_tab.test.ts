import {DocumentationTab} from "~/client/web/docs/internal/markdown/components/documentation_tab.js";

test("renders a titled tab section", () => {
    expect(DocumentationTab.markdown({title: "Curl", children: "curl example"})).toBe(
        "#### Curl\n\ncurl example",
    );
});

test("renders an empty heading when title is not a string", () => {
    expect(DocumentationTab.markdown({title: 7, children: "Body"})).toBe("#### \n\nBody");
});
