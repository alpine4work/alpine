import {DocumentationCheckbox} from "~/client/web/docs/internal/markdown/components/documentation_checkbox.js";

test("renders a checked task item marker", () => {
    expect(DocumentationCheckbox.markdown({checked: true})).toBe("[x] ");
});

test("renders missing checked state as an unchecked task item", () => {
    expect(DocumentationCheckbox.markdown({})).toBe("[ ] ");
});
