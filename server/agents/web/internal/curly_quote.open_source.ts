import {PhrasingContent} from "mdast";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.open_source.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.open_source.js";

/**
 * Quote some Markdown. We typically use this in `errorDisplayMessage` to quote
 * some Markdown written by an agent.
 *
 * Also escapes Markdown styles. Since this should render as plain, unformatted,
 * text in Markdown. Since the expectation by `printAgentWebError()` is that
 * `errorDisplayMessage` is Markdown formatted.
 */
export function curlyQuote(markdown: ReadonlyArray<PhrasingContent> | string) {
    let markdownString =
        typeof markdown === "string" ? markdown : printMarkdownPhrasingContentText(markdown);

    if (markdownString.length > 50) {
        markdownString = markdownString.slice(0, 50) + "…";
    }

    // Escapes a bunch of characters like newlines.
    markdownString = JSON.stringify(markdownString).slice(1, -1);

    // Force curly quotes to be balanced so they don't conflict with the curly quotes
    // we add.
    {
        let newMarkdownString = "";
        let openCurlyQuoteCount = 0;

        for (const character of markdownString) {
            if (character === "\u201C") {
                openCurlyQuoteCount++;
            } else if (character === "\u201D") {
                if (openCurlyQuoteCount > 0) {
                    openCurlyQuoteCount--;
                } else {
                    newMarkdownString = "\u201C" + newMarkdownString;
                }
            }

            newMarkdownString += character;
        }

        for (let i = 0; i < openCurlyQuoteCount; i++) {
            newMarkdownString += "\u201D";
        }

        markdownString = newMarkdownString;
    }

    // Escapes characters that aren't markdown safe.
    return printMarkdownTree({
        type: "paragraph",
        children: [{type: "text", value: `\u201C${markdownString}\u201D`}],
    }).trim();
}
