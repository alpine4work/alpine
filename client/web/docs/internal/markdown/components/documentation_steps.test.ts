import {DocumentationSteps} from "~/client/web/docs/internal/markdown/components/documentation_steps.js";

test("renders steps as a numbered list", () => {
    expect(DocumentationSteps.markdown({children: ["**First**\n\nDo it.", "**Second**"]})).toBe(
        "1. **First**\n\n   Do it.\n2. **Second**\n\n",
    );
});

test("drops empty children before numbering steps", () => {
    expect(DocumentationSteps.markdown({children: ["", "**First**\n\nBody", "  "]})).toBe(
        "1. **First**\n\n   Body\n\n",
    );
});
