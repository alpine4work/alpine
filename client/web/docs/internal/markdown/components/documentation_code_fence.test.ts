import {DocumentationCodeFence} from "~/client/web/docs/internal/markdown/components/documentation_code_fence.js";

test("renders a simple code fence child unchanged", () => {
    expect(DocumentationCodeFence.markdown({children: "```ts\nrun();\n```\n\n"})).toBe(
        "```ts\nrun();\n```\n\n",
    );
});

test("passes through already-rendered fenced code child markdown", () => {
    expect(DocumentationCodeFence.markdown({children: ["```ts\n", "run();\n", "```\n\n"]})).toBe(
        "```ts\nrun();\n```\n\n",
    );
});
