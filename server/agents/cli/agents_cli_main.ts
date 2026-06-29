import {highlightCode} from "@lezer/highlight";
import {parser as lezerMarkdownParser} from "@lezer/markdown";
import chalk from "chalk";
import * as prettier from "prettier";
import * as markdownPrettierPlugin from "prettier/plugins/markdown";
import {lezerClassHighlighter} from "~/shared/content/code/lezer_class_highlighter.js";
import {getErrorDisplayMessage} from "~/shared/error/default_error_display_message.js";

main().then(
    () => {
        process.exit(0);
    },
    error => {
        // NOCOMMIT: Log error display message.
        process.exit(1);
    },
);

async function main() {}

async function write(markdown: string) {
    markdown = markdown.trim();

    // Syntax highlight our Markdown if the terminal supports color.
    if (chalk.supportsColor) {
        markdown = await prettier.format(markdown, {
            parser: "markdown",
            endOfLine: "lf",
            printWidth: 80,
            tabWidth: 2,
            // If we are pretty printing the output with colors then wrap to 80 characters so
            // it fits nicely in the user's console.
            proseWrap: "always",
            plugins: [markdownPrettierPlugin],
        });

        let newMarkdown = "";

        // Highlight our exported Markdown or HTML.
        highlightCode(
            markdown,
            lezerMarkdownParser.parse(markdown),
            lezerClassHighlighter.get(),
            (text: string, classes: string) => {
                if (classes.length === 0) {
                    // NOCOMMIT: Escape ANSI codes.
                    newMarkdown += text;
                } else {
                    newMarkdown += `<span class="${classes}">${text}</span>`;
                }
            },
            () => {
                newMarkdown += "\n";
            },
        );

        markdown = newMarkdown;
    }
}
