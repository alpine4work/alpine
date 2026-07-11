import {DocumentationKbd} from "~/client/web/docs/internal/markdown/components/documentation_kbd.js";

test("renders keyboard shortcut markdown", () => {
    expect(DocumentationKbd.markdown({children: "Cmd K"})).toBe("`Cmd K`");
});

test("trims keyboard shortcut whitespace", () => {
    expect(DocumentationKbd.markdown({children: "  Cmd K  "})).toBe("`Cmd K`");
});
