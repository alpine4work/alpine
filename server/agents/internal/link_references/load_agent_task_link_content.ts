import {ListItem, Root, RootContent} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {DurableObjectTransactionInterface} from "~/server/agents/internal/durable_object_storage_collection.js";
import {AgentTaskLink} from "~/server/agents/internal/link_references/agent_link.js";
import {createAgentLink} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {
    printAgentLinkPath,
    printAgentPlainTextLabel,
} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {printApiContentToAgentMarkdownTree} from "~/server/agents/internal/print_api_content_to_agent_markdown.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

export async function loadAgentTaskLinkContent({
    tracer,
    transaction,
    request,
    link,
}: {
    tracer: TracerBase;
    transaction: DurableObjectTransactionInterface;
    request: Pick<AgentWebhookRequest, "spaceId" | "apiClient">;
    link: AgentTaskLink;
}): Promise<Root> {
    const {
        data: {task},
    } = await request.apiClient.get(tracer, "/tasks/{id}", {
        params: {path: {id: link.taskId}},
    });

    const children: Array<RootContent> = [];

    children.push({
        type: "heading",
        depth: 1,
        children: [{type: "text", value: task.title}],
    });

    const listItems: Array<ListItem> = [];
    children.push({type: "list", ordered: false, children: listItems});

    listItems.push({
        type: "listItem",
        children: [
            {
                type: "paragraph",
                children: [
                    {
                        type: "text",
                        value: `Status: ${task.status.type === "Open" ? "Open" : "Closed"}`,
                    },
                ],
            },
        ],
    });

    const assigneeLink = task.assignee
        ? await createAgentLink(transaction, {
              type: "Account",
              account: task.assignee,
          })
        : undefined;

    if (assigneeLink) {
        listItems.push({
            type: "listItem",
            children: [
                {
                    type: "paragraph",
                    children: [
                        {type: "text", value: "Assignee: "},
                        {
                            type: "link",
                            url: printAgentLinkPath(assigneeLink),
                            children: [
                                {type: "text", value: printAgentPlainTextLabel(assigneeLink)},
                            ],
                        },
                        ...(task.status.type === "Open" && task.status.isActive
                            ? [
                                  {
                                      type: "text" as const,
                                      value: " (they\u2019ve marked this task as active)",
                                  },
                              ]
                            : []),
                    ],
                },
            ],
        });
    }

    if (task.priority) {
        listItems.push({
            type: "listItem",
            children: [
                {
                    type: "paragraph",
                    children: [{type: "text", value: `Priority: ${task.priority}`}],
                },
            ],
        });
    }

    if (task.due?.date) {
        listItems.push({
            type: "listItem",
            children: [
                {
                    type: "paragraph",
                    // TODO(calebmer, #ai): Pretty date formatting like Jan 26, 2026 instead of
                    // 2026-01-26.
                    children: [{type: "text", value: `Due date: ${task.due.date}`}],
                },
            ],
        });
    }

    for (const node of (
        await printApiContentToAgentMarkdownTree(transaction, task.content, {
            spaceId: request.spaceId,
        })
    ).children) {
        children.push(node);
    }

    // TODO(calebmer, #ai): We should include the first few child tasks in
    // and give ChatGPT a tool to read more.

    return {type: "root", children};
}
