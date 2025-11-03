import {Root} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {AgentTaskCollectionLink} from "~/server/agents/internal/link_references/agent_link.js";
import {parseAgentContentToMarkdownRoot} from "~/server/agents/internal/link_references/parge_agent_content_to_markdown_root.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

// TODO(ifitzsimmons, #ai): Add sample content once we land on content format

export async function loadAgentTaskCollectionLinkContent({
    tracer,
    transaction,
    request,
    link,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: Pick<AgentWebhookRequest, "spaceId" | "apiClient">;
    link: AgentTaskCollectionLink;
}): Promise<Root> {
    const {
        data: {taskCollection},
    } = await request.apiClient.get(tracer, "/task-collections/{id}", {
        params: {path: {id: link.collectionId}},
    });

    // TODO(calebmer, #ai): We should include the first few tasks in
    // the task collection and give ChatGPT a tool to read more.
    return await parseAgentContentToMarkdownRoot({
        transaction,
        request,
        frontmatter: {
            type: "TaskCollection",
            name: taskCollection.name,
        },
    });
}
