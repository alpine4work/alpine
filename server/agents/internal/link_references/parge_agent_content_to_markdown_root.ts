import {Root} from "mdast";
import {stringify as stringifyYaml} from "yaml";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {DurableObjectTransactionInterface} from "~/server/agents/internal/durable_object_storage_collection.js";
import {AgentLink} from "~/server/agents/internal/link_references/agent_link.js";
import {
    printAgentLinkPath,
    printAgentPlainTextLabel,
} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {printAgentContentToMarkdownTree} from "~/server/agents/internal/print_agent_content_to_markdown.js";
import {printMarkdownTree} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {ApiContentResponse} from "~/shared/api/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export async function parseAgentContentToMarkdownRoot({
    transaction,
    request,
    frontmatter,
    content,
}: {
    transaction: DurableObjectTransactionInterface;
    request: Pick<AgentWebhookRequest, "spaceId">;
    frontmatter: Record<string, AgentLink | string | number | boolean | undefined>;
    content?: ApiContentResponse;
}): Promise<Root> {
    const markdownTree = await printAgentContentToMarkdownTree(
        transaction,
        content ?? {elements: []},
        {spaceId: request.spaceId},
    );

    markdownTree.children.unshift({
        type: "yaml",
        value: stringifyYaml(
            mapObjectValues(frontmatter, value => {
                // Use our Markdown mention syntax for links so the LLM can figure out it can
                // read this content with a `read_link` tool call.
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
