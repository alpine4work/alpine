import {extractDocumentationMdxToc} from "~/app/docs/codegen/extract_documentation_mdx_toc.js";

test("extracts h2 and h3 headings with stable ids", () => {
    const toc = extractDocumentationMdxToc(
        [
            "## Mentions & threads",
            "",
            "Some prose.",
            "",
            "### Deep dive",
            "",
            "```bash",
            "## not a heading",
            "```",
            "",
            "## Wrap up",
        ].join("\n"),
    );
    expect(toc).toEqual([
        {id: "mentions-threads", text: "Mentions & threads", level: 2},
        {id: "deep-dive", text: "Deep dive", level: 3},
        {id: "wrap-up", text: "Wrap up", level: 2},
    ]);
});
