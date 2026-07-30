import {DocumentationDivider} from "~/client/web/docs/internal/markdown/components/documentation_divider.js";

test("renders a thematic break", () => {
    expect(DocumentationDivider.markdown({})).toBe("---\n\n");
});

test("ignores props and renders a thematic break", () => {
    expect(DocumentationDivider.markdown({children: "ignored"})).toBe("---\n\n");
});
