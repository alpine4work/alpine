import {Root} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {AgentChannelLink} from "~/server/agents/internal/link_references/agent_link.js";
import {parseAgentContentToMarkdownTree} from "~/server/agents/internal/link_references/parse_agent_content_to_markdown_tree.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

// TODO(ifitzsimmons, #ai): Add sample content once we land on content format

export async function loadAgentChannelLinkContent({
    tracer,
    transaction,
    request,
    link,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: Pick<AgentWebhookRequest, "spaceId" | "apiClient">;
    link: AgentChannelLink;
}): Promise<Root> {
    const {
        data: {channel},
    } = await request.apiClient.get(tracer, "/channels/{id}", {
        params: {path: {id: link.channelId}},
    });

    return parseAgentContentToMarkdownTree({
        transaction,
        request,
        frontmatter: {
            type: "Channel",
            name: channel.name,
        },
        content: channel.description,
    });
}
