import {Root} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {AgentTaskLink} from "~/server/agents/internal/link_references/agent_link.js";
import {createAgentLink} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {parseAgentContentToMarkdownTree} from "~/server/agents/internal/link_references/parse_agent_content_to_markdown_tree.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

// TODO(ifitzsimmons, #ai): Add sample content once we land on content format

export async function loadAgentTaskLinkContent({
    tracer,
    transaction,
    request,
    link,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransaction;
    request: Pick<AgentWebhookRequest, "spaceId" | "apiClient">;
    link: AgentTaskLink;
}): Promise<Root> {
    const {
        data: {task},
    } = await request.apiClient.get(tracer, "/tasks/{id}", {
        params: {path: {id: link.taskId}},
    });

    const assigneeLink = task.assignee
        ? await createAgentLink(transaction, {
              type: "Account",
              account: task.assignee,
          })
        : undefined;

    // TODO(calebmer, #ai): We should include the first few child tasks in
    // and give ChatGPT a tool to read more.
    return parseAgentContentToMarkdownTree({
        transaction,
        request,
        frontmatter: {
            type: "Task",
            status: task.status.type,
            isActive: task.status.type === "Open" ? task.status.isActive : undefined,
            title: task.title,
            assignee: assigneeLink,
            dueDate: task.due?.date,
            priority: task.priority,
        },
        content: task.content,
    });
}
