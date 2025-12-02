import {Root} from "mdast";
import {printMarkdownTree} from "~/server/api/markdown/print_api_content_to_markdown.js";

/**
 * Agent content includes html tags for things such as wrapping messages from a user.
 * For example, a message from Alice looks like
 *
 * ```html
 * <human name="Alice">
 * {markdownContent}
 * </human>
 * ```
 * The problem is that `printMarkdownTree` adds new lines around each markdown "block". So the
 * above example actually looks like the following (assuming the content is a paragraph with
 * text "Hello!"):
 * ```html
 * <human name="Alice">
 *
 * Hello!
 *
 * </human>
 * ```
 *
 * The new lines are technically correct, but are not useful for the LLM. They also make the log
 * harder to read. This function strips new lines after opening message tags and before closing
 * message tags.
 */
export function printAgentContentMarkdownTree(markdownRoot: Root): string {
    const markdownString = printMarkdownTree(markdownRoot);

    return markdownString
        .replaceAll(/^(<(?:human|bot)(?:>| [^>]*>))\n/gm, "$1")
        .replaceAll(/\n(<\/(?:human|bot)(?:>| [^>]*>))$/gm, "$1");
}
