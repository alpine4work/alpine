import {DocumentationStep} from "~/client/web/docs/internal/markdown/components/documentation_step.js";

test("renders a titled step with body", () => {
    expect(DocumentationStep.markdown({title: "First", children: "Do it."})).toBe(
        "**First**\n\nDo it.",
    );
});

test("renders body-only steps when the title prop is not a string", () => {
    expect(DocumentationStep.markdown({title: 42, children: "Do it."})).toBe("Do it.");
});
