import {DocumentationFrame} from "~/client/web/docs/internal/markdown/components/documentation_frame.js";

test("renders frame label and caption as a blockquote", () => {
    expect(DocumentationFrame.markdown({label: "Inbox", caption: "The inbox."})).toBe(
        "> [Inbox]\n> The inbox.\n\n",
    );
});

test("uses the default screenshot label when label is omitted", () => {
    expect(DocumentationFrame.markdown({caption: ""})).toBe("> [product screenshot]\n\n");
});
