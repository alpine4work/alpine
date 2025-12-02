import {Root} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {AgentAccountLink} from "~/server/agents/internal/link_references/agent_link.js";
import {parseAgentContentToMarkdownRoot} from "~/server/agents/internal/link_references/parse_agent_content_to_markdown_root.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

// TODO(ifitzsimmons, #ai): Add sample content once we land on content format
export async function loadAgentAccountLinkContent({
    tracer,
    transaction,
    request,
    link,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: Pick<AgentWebhookRequest, "spaceId" | "apiClient">;
    link: AgentAccountLink;
}): Promise<Root> {
    const {
        data: {account},
    } = await request.apiClient.get(tracer, "/spaces/{id}/accounts/{accountId}", {
        params: {path: {id: request.spaceId, accountId: link.accountId}},
    });

    return await parseAgentContentToMarkdownRoot({
        transaction,
        request,
        frontmatter: {
            type: "Account",
            name: account.name,
            isBot: account.botId ? true : undefined,
            wasRemoved: account.space.inactive?.type === "Removed" ? true : undefined,
        },
    });
}
