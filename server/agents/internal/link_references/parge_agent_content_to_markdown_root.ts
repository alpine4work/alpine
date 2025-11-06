import {Root} from "mdast";
import {stringify as stringifyYaml} from "yaml";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {DurableObjectTransactionInterface} from "~/server/agents/internal/durable_object_storage_collection.js";
import {AgentLink} from "~/server/agents/internal/link_references/agent_link.js";
import {printEscapedMarkdownLinkLabel} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {printAgentLinkPath} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {printAgentContentToMarkdownTree} from "~/server/agents/internal/print_agent_content_to_markdown.js";
import {ApiContentResponse} from "~/shared/api/types/api_specification_convenience_types.js";
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
                    return `[${printEscapedMarkdownLinkLabel(value)}](${printAgentLinkPath(
                        value,
                    )})`;

                return value;
            }),
        ).trim(),
    });

    return markdownTree;
}
