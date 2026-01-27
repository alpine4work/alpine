import {Parent} from "mdast";
import {parseMarkdownTree} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";

/**
 * Template string tag that tells Prettier to format the string as Markdown.
 *
 * Should be imported as:
 *
 * ```ts
 * import {agentInstructionsMarkdown as markdown} from "~/server/agents/internal/agent_instructions_markdown.js";
 * ```
 *
 * Since the template string needs to be named `markdown` to be correctly
 * formatted by Prettier.
 */
export function agentInstructionsMarkdown(
    template: TemplateStringsArray,
    ...substitutions: Array<unknown>
): Lazy<string> {
    assert(substitutions.length === 0, "Substitutions break Prettier formatting");
    assert(template.length === 1);
    const string = template[0]!;

    // Parse/print our instructions template using the same Markdown parser/printer
    // that we use for printing API content. The fear is Markdown in an
    // inconsistent format (the Markdown in this file is formatted by Prettier)
    // will confuse LLMs.
    return new Lazy(() => {
        const root = parseMarkdownTree(string.trim());

        const traverse = (node: Parent) => {
            for (const child of node.children) {
                if (child.type === "text") {
                    child.value = child.value.replaceAll(/\n+/g, " ");
                }

                if ("children" in child) {
                    traverse(child);
                }
            }
        };

        traverse(root);

        return printMarkdownTree(root);
    });
}
