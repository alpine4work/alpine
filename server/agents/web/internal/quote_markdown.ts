import {PhrasingContent} from "mdast";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";

/**
 * Quote some Markdown. We typically use this in `errorDisplayMessage` to quote
 * some Markdown written by an agent.
 */
export function quoteMarkdown(markdown: Array<PhrasingContent>) {
    let markdownString = printMarkdownPhrasingContentText(markdown);

    if (markdownString.length > 50) {
        markdownString = markdownString.slice(0, 50) + "…";
    }

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

    return `\u201C${markdownString}\u201D`;
}
