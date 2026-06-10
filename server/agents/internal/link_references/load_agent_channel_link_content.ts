import {Root} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {DurableObjectTransactionInterface} from "~/server/agents/internal/durable_object_storage_collection.js";
import {AgentChannelLink} from "~/server/agents/internal/link_references/agent_link.js";
import {printApiContentToAgentMarkdownTreeWithFrontmatter} from "~/server/agents/internal/print_api_content_to_agent_markdown_tree_with_frontmatter.ts.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

// TODO(ifitzsimmons, #ai): Add sample content once we land on content format

export async function loadAgentChannelLinkContent({
    tracer,
    transaction,
    request,
    link,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: Pick<AgentWebhookRequest, "spaceId" | "apiClient">;
    link: AgentChannelLink;
}): Promise<Root> {
    const {
        data: {channel},
    } = await request.apiClient.get(tracer, "/channels/{id}", {
        params: {path: {id: link.channelId}},
    });

    return await printApiContentToAgentMarkdownTreeWithFrontmatter({
        transaction,
        frontmatter: {
            type: "Channel",
            name: channel.name,
        },
        content: channel.description,
    });
}
