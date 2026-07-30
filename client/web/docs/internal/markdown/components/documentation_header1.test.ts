import {DocumentationHeader1} from "~/client/web/docs/internal/markdown/components/documentation_header1.js";

test("renders a level one heading", () => {
    expect(DocumentationHeader1.markdown({children: "Overview"})).toBe("# Overview\n\n");
});

test("flattens heading children before rendering level one markdown", () => {
    expect(DocumentationHeader1.markdown({children: ["Intro ", 2, false]})).toBe("# Intro 2\n\n");
});
