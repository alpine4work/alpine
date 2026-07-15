import * as prettier from "prettier";
import * as markdownPrettierPlugin from "prettier/plugins/markdown";

export async function formatAgentWebMarkdown(markdown: string): Promise<string> {
    // Use Prettier to print our Markdown before sending it to the LLM. We hypothesize
    // this will lead to better performance from the LLM since Prettier formatting is
    // more "standard" than micromark's (used by `printMarkdownTree()`) default
    // formatting.
    markdown = await prettier.format(markdown, {
        parser: "markdown",
        endOfLine: "lf",
        printWidth: 80,
        tabWidth: 2,
        // We never wrap text within paragraphs at 80 characters. This is entirely
        // presentational. Two reasons why we think it's bad for LLMs:
        //
        // 1. Pagination via newlines ends up being more semantic since it's close to
        //    paginating by paragraphs in a long document.
        //
        // 2. We're guessing LLMs are trained on vastly more text without presentational
        //    line breaks than text with presentational line breaks. So the LLM should be
        //    slightly more intelligent when not presented with text that has
        //    presentational line breaks.
        //
        // Wrapping at 80 characters is good for a human reader but not necessarily for an
        // LLM reader.
        proseWrap: "never",
        plugins: [markdownPrettierPlugin],
    });

    markdown = markdown.trim();

    return markdown;
}
