import {List, ListItem, Paragraph, PhrasingContent, Root} from "mdast";
import {AgentWebhookRequest} from "~/server/agents/internal/agent_durable_object_base.js";
import {DurableObjectTransactionInterface} from "~/server/agents/internal/durable_object_storage_collection.js";
import {AgentTaskCollectionLink} from "~/server/agents/internal/link_references/agent_link.js";
import {
    createAgentLink,
    defaultAgentTaskCollectionStatusesFilter,
} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {
    printAgentLinkPath,
    printAgentPlainTextLabel,
} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {
    ApiAccount,
    ApiTaskCollection,
    ApiTaskStatus,
    ApiTaskWithoutContent,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

const taskStatusesFilterValues = new Set<ApiTaskStatus["type"]>(["Open", "Closed"]);

/**
 * Returns the task collection and first 100 tasks in the collection. The format is as follows
 *
 * ```markdown
 * These are the Open (Active) and Open (Inactive) tasks in the Sprint Tasks collection. See
 * [here for Closed tasks](/task-collection/sprint-tasks-other-tasks) in this collection.
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
    transaction: DurableObjectTransactionInterface;
    request: Pick<AgentWebhookRequest, "spaceId" | "apiClient">;
    link: AgentTaskCollectionLink;
}): Promise<Root> {
    const appliedStatusesFilter =
        link.statusesFilter.size > 0
            ? link.statusesFilter
            : defaultAgentTaskCollectionStatusesFilter;

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
            params: {
                path: {id: link.collectionId},
                query: {limit: 100, status: Array.from(appliedStatusesFilter)},
            },
        }),
    ]);

    if (tasks.length === 0)
        return getEmptyTaskCollectionContent(taskCollection, appliedStatusesFilter);

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
    const [preambleContent, ...tasksContent] = await runAllPromises([
        getTaskCollectionPreamble(transaction, link, taskCollection, appliedStatusesFilter),
        ...taskContentPromises,
    ]);

    return {
        type: "root",
        children: [preambleContent, {type: "list", ordered: true, children: tasksContent}],
    };
}

async function getTaskCollectionPreamble(
    transaction: DurableObjectTransactionInterface,
    link: Omit<AgentTaskCollectionLink, "statusesFilter">,
    taskCollection: ApiTaskCollection,
    appliedStatusesFilter: ReadonlySet<ApiTaskStatus["type"]>,
): Promise<Paragraph> {
    const children: Array<PhrasingContent> = [];

    const missingStatuses = taskStatusesFilterValues.difference(appliedStatusesFilter);
    const prettyConjunctionMissingStatuses = joinPrettyConjunctionList(
        Array.from(missingStatuses),
        "and",
    );

    // If the task collection is loading ALL tasks, it's a waste of tokens
    // to tell the agent that there aren't any tasks for Open (Active), Open (Inactive), or Closed.
    // We can just say that there aren't any tasks in the collection.
    const taskStatusDescriptor =
        missingStatuses.size === 0
            ? "all of the"
            : `the ${joinPrettyConjunctionList(Array.from(appliedStatusesFilter), "and")}`;

    children.push({
        type: "text",
        value: `These are ${taskStatusDescriptor} tasks in the ${taskCollection.name} collection.`,
    });

    // NOTE(iftizsimmons, 2025-12-11): If the task collection only loaded tasks with a
    // subset of the statuses, we should include a link to the task collection with the
    // missing statuses.
    //
    // When asking an agent "What did I do last sprint?", it will (hopefully) load the
    // appropriate sprint collection. However, we only load Open (Active) and Open (Inactive)
    // tasks by default. So the agent won't actually be able to see the tasks you completed
    // (the work you *actually did*) last sprint.
    //
    // By giving the agent a link to the task collection with the missing status types, it can
    // create a more complete picture of what is going on in that collection if it needs to do
    // so.
    if (missingStatuses.size > 0) {
        const collectionWithMissingStatusLink = await createAgentLink(transaction, {
            type: "TaskCollection",
            taskCollection: {
                id: link.collectionId,
                name: `${link.name} ${prettyConjunctionMissingStatuses} Tasks`,
                statusesFilter: missingStatuses,
            },
        });

        children.push(
            {
                type: "text",
                value: " See ",
            },
            {
                type: "link",
                url: printAgentLinkPath(collectionWithMissingStatusLink),
                children: [
                    {
                        type: "text",
                        value: `here for ${prettyConjunctionMissingStatuses} tasks`,
                    },
                ],
            },
            {type: "text", value: " in this collection."},
        );
    }

    return {
        type: "paragraph",
        children,
    };
}

function getEmptyTaskCollectionContent(
    taskCollection: ApiTaskCollection,
    appliedStatusesFilter: ReadonlySet<ApiTaskStatus["type"]>,
): Root {
    // If the task collection is loading ALL tasks, it's a waste of tokens
    // to tell the agent that there aren't any tasks for Open (Active), Open (Inactive), or Closed.
    // We can just say that there aren't any tasks in the collection.
    const taskStatusDescriptor =
        taskStatusesFilterValues.difference(appliedStatusesFilter).size === 0
            ? ""
            : ` ${joinPrettyConjunctionList(Array.from(appliedStatusesFilter), "or")}`;

    return {
        type: "root",
        children: [
            {
                type: "text",
                value: `There aren\u2019t any${taskStatusDescriptor} tasks in the ${taskCollection.name} collection.`,
            },
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
    transaction: DurableObjectTransactionInterface,
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
    transaction: DurableObjectTransactionInterface,
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
