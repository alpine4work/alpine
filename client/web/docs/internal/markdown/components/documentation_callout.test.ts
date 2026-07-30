import {DocumentationCallout} from "~/client/web/docs/internal/markdown/components/documentation_callout.js";

test("renders a titled info callout", () => {
    expect(
        DocumentationCallout.markdown({
            type: "info",
            title: "Heads up",
            children: "Read this.",
        }),
    ).toBe("> [!NOTE]\n> **Heads up**\n> Read this.\n\n");
});

test("falls back to note callout for an unknown type and quotes blank lines", () => {
    expect(
        DocumentationCallout.markdown({
            type: "unknown",
            title: 12,
            children: "Line one\n\nLine two",
        }),
    ).toBe("> [!NOTE]\n> Line one\n>\n> Line two\n\n");
});
