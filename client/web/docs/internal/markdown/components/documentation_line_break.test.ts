import {DocumentationLineBreak} from "~/client/web/docs/internal/markdown/components/documentation_line_break.js";

test("renders a hard line break", () => {
    expect(DocumentationLineBreak.markdown({})).toBe("  \n");
});

test("renders a markdown hard line break", () => {
    expect(DocumentationLineBreak.markdown({children: "ignored"})).toBe("  \n");
});
