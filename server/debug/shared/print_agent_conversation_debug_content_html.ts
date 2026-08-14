import {highlightCode} from "@lezer/highlight";
import {parser as lezerHtmlParser} from "@lezer/html";
import {parser as lezerJsonParser} from "@lezer/json";
import {parser as lezerMarkdownParser, parseCode as parseLezerMarkdownCode} from "@lezer/markdown";
import escapeHtml from "escape-html";
// @ts-expect-error: After upgrading Prettier, we need to directly import
// `prettier/index.mjs` to make sure we don't get the standalone build.
// However, there's no blessed way from Prettier to import the full version
// with types.
import * as prettier from "prettier/index.mjs";
import {lezerClassHighlighter} from "~/shared/lezer/lezer_class_highlighter.open_source.js";

/** The languages an agent's conversation content is written in. */
export type AgentConversationDebugContentLanguage = "markdown" | "json";

// Agents write prose in Markdown, but they also inline HTML in it (e.g.
// `<human name="Alice">`), so we highlight embedded HTML too.
const lezerDebugMarkdownParser = lezerMarkdownParser.configure(
    parseLezerMarkdownCode({htmlParser: lezerHtmlParser}),
);

/**
 * Pretty prints an agent conversation item's content with Prettier then syntax
 * highlights it into HTML, ready to render in the debugger's conversation state
 * view (see `agent_conversation_debug_view.tsx`).
 *
 * Shared by the ChatGPT and Claude debuggers so both read the same way.
 */
export async function printAgentConversationDebugContentHtml(
    text: string,
    language: AgentConversationDebugContentLanguage,
): Promise<string> {
    let sourceText = text;

    // Technically `_world_` below isn't italicized if you're following the CommonMark
    // spec. Since text on an adjacent line to HTML is considered more HTML.
    //
    // ```
    // <human name="Alice>
    // Hello, _world_!
    // </human>
    // ```
    //
    // In the following `_world_` is properly italicized:
    //
    // ```
    // <human name="Alice>
    //
    // Hello, _world_!
    //
    // </human>
    // ```
    //
    // The following adds extra newlines next to HTML open/close tags so Prettier and
    // Lezer (which are sticklers for valid syntax) parse our Markdown correctly.
    if (language === "markdown") {
        sourceText = sourceText
            .replaceAll(/^<[a-z]+[^>]*>\n\n?/gm, substring =>
                !substring.endsWith("\n\n") ? `${substring}\n` : substring,
            )
            .replaceAll(/\n\n?<\/[a-z]+[^>]*>$/gm, substring =>
                !substring.startsWith("\n\n") ? `\n${substring}` : substring,
            );
    }

    const prettyText = await prettier.format(sourceText, {
        parser: language,
        printWidth: 80,
        tabWidth: 2,
        proseWrap: "always",
    });

    const lezerParser = language === "markdown" ? lezerDebugMarkdownParser : lezerJsonParser;

    let contentHtml = "";

    highlightCode(
        prettyText,
        lezerParser.parse(prettyText),
        lezerClassHighlighter.get(),
        (tokenText: string, classes: string) => {
            if (classes.length === 0) {
                contentHtml += escapeHtml(tokenText);
            } else {
                contentHtml += `<span class="${classes}">${escapeHtml(tokenText)}</span>`;
            }
        },
        () => {
            contentHtml += "\n";
        },
    );

    // Convert:
    //
    // ```
    // <human name="Alice>
    //
    // Hello, _world_!
    //
    // </human>
    // ```
    //
    // ...back into our unofficial but more readable syntax:
    //
    // ```
    // <human name="Alice>
    // Hello, _world_!
    // </human>
    // ```
    if (language === "markdown") {
        contentHtml = contentHtml
            .replaceAll(
                /<span class="tok-punctuation">&lt;<\/span>.*?<span class="tok-punctuation">&gt;<\/span>\n\n/g,
                substring => substring.slice(0, -1),
            )
            .replaceAll(
                /\n\n<span class="tok-punctuation">&lt;\/<\/span>.*?<span class="tok-punctuation">&gt;<\/span>/g,
                substring => substring.slice(1),
            );
    }

    return contentHtml;
}
