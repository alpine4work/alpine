import {DocumentationBold} from "~/client/web/docs/internal/markdown/components/documentation_bold.js";

test("renders bold markdown", () => {
    expect(DocumentationBold.markdown({children: "Important"})).toBe("**Important**");
});

test("flattens non-string children into bold markdown", () => {
    expect(DocumentationBold.markdown({children: ["Count ", 2, false]})).toBe("**Count 2**");
});
