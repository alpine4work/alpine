import {List, ListItem, Root} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {AgentTaskCollectionLink} from "~/server/agents/internal/link_references/agent_link.js";
import {createAgentLink} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {parseAgentContentToMarkdownRoot} from "~/server/agents/internal/link_references/parse_agent_content_to_markdown_root.js";
import {
    printAgentLinkPath,
    printAgentPlainTextLabel,
} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {
    ApiAccount,
    ApiTaskStatus,
    ApiTaskWithoutContent,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * Returns the task collection and first 100 tasks in the collection. The format is as follows
 *
 * ```markdown
 * ---
 * type: TaskCollection
 * name: Test collection
 * ---
 *
 * 1. [Title 1](/task/title-1)
 *    - Status: Open (Active)
 *    - Assignee: [Test](/account/test)
 *    - Due: 2025-12-17
 *    - Priority: Urgent
 * 2. [Title 2](/task/title-2)
 *    - Status: Open (Inactive)
 *    - Assignee: [Ian](/account/ian)
 *    - Due: 2025-11-21
 * 3. [Title 3](/task/title-3)
 *    - Status: Open (Inactive)
 *    - Priority: High
 * 4. [Title 4](/task/title-4)
 *    - Status: Open (Active)
 *    - Assignee: [calbe@gmail.com](/account/calbe-gmail-com)
 * ```
 */
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
    const [
        {
            data: {taskCollection},
        },
        {
            data: {tasks},
        },
    ] = await runAllPromises([
        request.apiClient.get(tracer, "/task-collections/{id}", {
            params: {path: {id: link.collectionId}},
        }),
        request.apiClient.get(tracer, "/task-collections/{id}/tasks", {
            params: {path: {id: link.collectionId}, query: {limit: 100}},
        }),
    ]);

    const taskContentPromises = tasks.map(async (task): Promise<ListItem> => {
        const taskLink = await createAgentLink(transaction, {type: "Task", task});

        return {
            type: "listItem",
            children: [
                {
                    type: "paragraph",
                    children: [
                        {
                            type: "link",
                            url: printAgentLinkPath(taskLink),
                            children: [{type: "text", value: printAgentPlainTextLabel(taskLink)}],
                        },
                    ],
                },
                await intoTaskMetadataList(transaction, task),
            ],
        };
    });

    // TODO(calebmer, #ai): We should include the first few tasks in
    // the task collection and give ChatGPT a tool to read more.
    const [collectionContent, ...tasksContent] = await runAllPromises([
        parseAgentContentToMarkdownRoot({
            transaction,
            request,
            frontmatter: {
                type: "TaskCollection",
                name: taskCollection.name,
            },
        }),
        ...taskContentPromises,
    ]);
    return {
        type: "root",
        children: [
            ...collectionContent.children,
            {type: "list", ordered: true, children: tasksContent},
        ],
    };
}

function printTaskStatus(status: ApiTaskStatus): string {
    switch (status.type) {
        case "Open":
            return status.isActive ? "Open (Active)" : "Open (Inactive)";
        case "Closed":
            return "Closed";
    }
}

async function intoTaskMetadataList(
    transaction: DurableObjectTransaction,
    task: ApiTaskWithoutContent,
): Promise<List> {
    const assigneeListItem = await intoAssigneeListItem(transaction, task.assignee);
    const dueDateListItem = intoDueDateListItem(task.due);
    const priorityListItem = intoPriorityListItem(task.priority);

    return {
        type: "list",
        ordered: false,
        children: [
            {
                type: "listItem",
                children: [
                    {
                        type: "paragraph",
                        children: [
                            {type: "text", value: `Status: ${printTaskStatus(task.status)}`},
                        ],
                    },
                ],
            },
            ...(assigneeListItem ? [assigneeListItem] : []),
            ...(dueDateListItem ? [dueDateListItem] : []),
            ...(priorityListItem ? [priorityListItem] : []),
        ],
    };
}

async function intoAssigneeListItem(
    transaction: DurableObjectTransaction,
    assignee: ApiAccount | undefined,
): Promise<ListItem | undefined> {
    if (!assignee) return undefined;

    const assigneeLink = await createAgentLink(transaction, {type: "Account", account: assignee});

    return {
        type: "listItem",
        children: [
            {
                type: "paragraph",
                children: [
                    {type: "text", value: `Assignee: `},
                    {
                        type: "link",
                        url: printAgentLinkPath(assigneeLink),
                        children: [
                            {
                                type: "text",
                                value: printAgentPlainTextLabel(assigneeLink),
                            },
                        ],
                    },
                ],
            },
        ],
    };
}

function intoDueDateListItem(due: {date: string} | undefined): ListItem | undefined {
    if (!due) return undefined;

    return {
        type: "listItem",
        children: [{type: "paragraph", children: [{type: "text", value: `Due: ${due.date}`}]}],
    };
}

function intoPriorityListItem(priority: string | undefined): ListItem | undefined {
    if (!priority) return undefined;

    return {
        type: "listItem",
        children: [{type: "paragraph", children: [{type: "text", value: `Priority: ${priority}`}]}],
    };
}
