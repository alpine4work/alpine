import {Root} from "mdast";
import {stringify as stringifyYaml} from "yaml";
import {AgentLink} from "~/server/agents/bots/internal/link_references/agent_link.js";
import {
    printAgentLinkPath,
    printAgentPlainTextLabel,
} from "~/server/agents/bots/internal/link_references/print_agent_link_path.js";
import {printApiContentToAgentMarkdownTree} from "~/server/agents/bots/internal/print_api_content_to_agent_markdown.js";
import {DurableObjectTransactionInterface} from "~/server/cloudflare/durable_object_storage_collection.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export async function printApiContentToAgentMarkdownTreeWithFrontmatter({
    transaction,
    frontmatter,
    content,
}: {
    transaction: DurableObjectTransactionInterface;
    frontmatter: Record<string, AgentLink | string | number | boolean | undefined>;
    content?: ApiContentResponseWithoutKeys;
}): Promise<Root> {
    const markdownTree = await printApiContentToAgentMarkdownTree(
        transaction,
        content ?? {elements: []},
    );

    markdownTree.children.unshift({
        type: "yaml",
        value: stringifyYaml(
            mapObjectValues(frontmatter, value => {
                // Use our Markdown mention syntax for links so the LLM can figure out it can read
                // this content with a `read_link` tool call.
                if (isObject(value))
                    return `[${escapeMarkdownLinkLabel(
                        printAgentPlainTextLabel(value),
                    )}](${printAgentLinkPath(value)})`;

                return value;
            }),
        ).trim(),
    });

    return markdownTree;
}

function escapeMarkdownLinkLabel(contents: string): string {
    const markdown = printMarkdownTree({
        type: "root",
        children: [
            {
                type: "linkReference",
                referenceType: "collapsed",
                identifier: "",
                children: [{type: "text", value: contents}],
            },
        ],
    }).trim();

    assert(markdown.startsWith("["));
    assert(markdown.endsWith("][]"));

    return markdown.slice(1, -3);
}
