import {produce} from "immer";
import {List, PhrasingContent, Root, RootContent} from "mdast";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {printAgentWebPageStoredLinkLabel} from "~/server/agents/web/agent_web_page_stored_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {parseAgentWebTaskQueryFilters} from "~/server/agents/web/agent_web_task_query_filters.js";
import {parseAgentWebTaskQuerySorts} from "~/server/agents/web/agent_web_task_query_sorts.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {
    AgentWebTaskQueryPage,
    AgentWebTaskQueryPageMetadata,
    agentWebTaskQueryPageNextPageLinkText,
    intoAgentWebTaskQueryPageTask,
    normalizeAgentWebTaskQueryPage,
    parseAgentWebTaskQueryPageTaskReference,
    parseAgentWebTaskQueryPageTasks,
    printAgentWebTaskQueryPageSearchParams,
    printAgentWebTaskQueryPageTaskList,
    readAgentWebTaskQueryPage,
    updateAgentWebTaskQueryPage,
} from "~/server/agents/web/pages/agent_web_task_query_page.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {
    ApiTaskReferenceResponse,
    ApiTaskWithoutNotesResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {TaskId} from "~/shared/id/types/id_types.js";

export type AgentWebTaskSubtasksPage = AgentWebTaskQueryPage & {
    readonly type: "TaskSubtasks";
    readonly task: ApiTaskReferenceResponse;
};

export type AgentWebTaskSubtasksPageMetadata = AgentWebTaskQueryPageMetadata & {
    readonly type: "TaskSubtasks";
    readonly id: TaskId;
};

export type AgentWebTaskSubtasksPageWithMetadata = AgentWebTaskSubtasksPage & {
    readonly metadata: AgentWebTaskSubtasksPageMetadata;
};

export async function readAgentWebTaskSubtasksPage(
    context: AgentWebContext,
    taskId: TaskId,
    {
        searchParams,
        limitLength,
        printPage,
    }: {
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebTaskSubtasksPage) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebTaskSubtasksPageMetadata}> {
    const result = await readAgentWebTaskQueryPage<
        ApiTaskWithoutNotesResponse,
        AgentWebTaskSubtasksPage
    >(context, {
        pageLink: {type: "TaskSubtasks", task: {id: taskId}},
        searchParams,
        limitLength,
        readTaskBatch: async ({cursor, query, limit}) => {
            const tasksResult =
                query.filters.length === 0 && query.sorts.length === 0
                    ? await context.api.get(context.span, "/tasks/{id}-without-notes/subtasks", {
                          params: {path: {id: taskId}, query: {limit, cursor}},
                      })
                    : await context.api.post(
                          context.span,
                          "/tasks/{id}-without-notes/subtasks-query",
                          {
                              params: {path: {id: taskId}},
                              body: {
                                  limit,
                                  cursor,
                                  filters: query.filters,
                                  sorts: query.sorts,
                              },
                          },
                      );

            return {
                pageLink: {
                    type: "TaskSubtasks",
                    task: {
                        type: "Task",
                        id: taskId,
                        title: tasksResult.data.task.title,
                        status: tasksResult.data.task.status,
                    },
                },
                resource: tasksResult.data.task,
                isManuallyOrdered: query.filters.length === 0 && query.sorts.length === 0,
                nextCursor: tasksResult.data.nextCursor,
                tasks: tasksResult.data.tasks,
            };
        },
        intoPageTask: ({task, contextDate}) =>
            intoAgentWebTaskQueryPageTask({
                timeZone: context.timeZone,
                contextDate,
                // We know all the tasks are children of our parent task. So don't include the
                // `- Parent` field.
                omittedParentTaskId: taskId,
                task,
            }),
        buildPage: ({queryPage, resource: task}): AgentWebTaskSubtasksPage => ({
            type: "TaskSubtasks",
            task: {
                type: "Task",
                id: task.id,
                title: task.title,
                status: task.status,
            },
            ...queryPage,
        }),
        printPage,
    });

    return {
        response: result.response,
        metadata: {...result.metadata, type: "TaskSubtasks", id: taskId},
    };
}

export function normalizeAgentWebTaskSubtasksPage<Page extends AgentWebTaskSubtasksPage>(
    page: Page,
): Page {
    return produce(page, page => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            normalizer.normalizeReference(page.task);
            normalizeAgentWebTaskQueryPage(normalizer, page);
        });
    });
}

// NOCOMMIT: Test that you can't add a `- Parent` field in an update in subtasks
// page (or task page subtasks)
export async function updateAgentWebTaskSubtasksPage(
    context: AgentWebContext,
    oldPageMetadata: AgentWebTaskSubtasksPageMetadata,
    oldPage: AgentWebTaskSubtasksPage,
    newPage: AgentWebTaskSubtasksPage,
): Promise<AgentWebTaskSubtasksPageMetadata> {
    if (!isDeepEqual(oldPage.task, newPage.task)) {
        throw new InvalidArgumentError("Can\u2019t update task subtasks preamble", {
            displayMessage: errorDisplayMessage`You can only update subtasks. You can\u2019t change which task the subtasks belong to on line 1. Try again with a more specific update that only changes the subtasks.`,
        });
    }

    const {execute} = await updateAgentWebTaskQueryPage(
        context,
        {type: "TaskSubtasks", task: {id: oldPage.task.id}},
        oldPageMetadata,
        oldPage,
        newPage,
    );

    return {...(await execute()), type: "TaskSubtasks", id: oldPageMetadata.id};
}

export async function printAgentWebTaskSubtasksPage(
    storage: AgentWebSessionStorage,
    page: AgentWebTaskSubtasksPage,
): Promise<Root> {
    const children: Array<RootContent> = [];

    const [taskPathname, paginationSearch, taskList] = await runAllPromises([
        createAgentWebPageStoredLinkPathname(storage, page.task),
        page.pagination === null
            ? Promise.resolve(null)
            : printAgentWebTaskQueryPageSearchParams(storage, page.pagination),
        printAgentWebTaskQueryPageTaskList(storage, page.tasks),
    ]);

    const preambleChildren: Array<PhrasingContent> = [
        {type: "text", value: "Subtasks for "},
        {
            type: "link",
            url: taskPathname,
            children: [
                {
                    type: "text",
                    value: printAgentWebPageStoredLinkLabel(page.task),
                },
            ],
        },
        {type: "text", value: paginationSearch === null ? "." : ". "},
    ];

    if (paginationSearch !== null) {
        preambleChildren.push({
            type: "link",
            url: `${taskPathname}/subtasks?${paginationSearch}`,
            children: [{type: "text", value: agentWebTaskQueryPageNextPageLinkText}],
        });
    }

    children.push({type: "paragraph" as const, children: preambleChildren});

    if (taskList !== null) children.push(taskList);

    if (page.isEndOfTasks) {
        children.push({
            type: "paragraph",
            children: [{type: "text", value: "End of tasks."}],
        });
    }

    return {type: "root", children};
}

export async function parseAgentWebTaskSubtasksPage(
    storage: AgentWebSessionStorage,
    id: TaskId | null,
    root: Root,
): Promise<AgentWebTaskSubtasksPage> {
    const firstChild = root.children[0];
    if (firstChild?.type !== "paragraph") {
        throw createAgentWebTaskSubtasksPreambleError(firstChild);
    }

    let taskList: List | null = null;
    let isEndOfTasks = false;

    for (const child of root.children.slice(1)) {
        if (isEndOfTasks) {
            throw new InvalidArgumentError("Content after end of task subtasks", {
                displayMessage: errorDisplayMessage`Nothing may appear after \u201CEnd of tasks\u201D in subtasks markdown. Try again after removing the extra content after \u201CEnd of tasks\u201D on line ${child.position?.start.line ?? "unknown"}.`,
            });
        }

        if (
            child.type === "paragraph" &&
            /^End of tasks\.?$/.test(printMarkdownPhrasingContentText(child.children))
        ) {
            isEndOfTasks = true;
            continue;
        }

        if (child.type === "list" && !child.ordered && taskList === null) {
            taskList = child;
            continue;
        }

        throw new InvalidArgumentError("Unexpected markdown in task subtasks page", {
            displayMessage: errorDisplayMessage`Unexpected markdown on line ${child.position?.start.line ?? "unknown"}. Try again with \u201cSubtasks for [My Task (Open)](/task/my-task).\u201d on line 1 followed by a task list (an unordered list where every item is a task link).`,
        });
    }

    const [{task, pagination}, tasks] = await runAllPromises([
        parseAgentWebTaskSubtasksPreamble(storage, firstChild),
        parseAgentWebTaskQueryPageTasks(storage, "TaskSubtasks", taskList),
    ]);

    return {
        type: "TaskSubtasks",
        task,
        pagination,
        tasks,
        isEndOfTasks,
    };
}

async function parseAgentWebTaskSubtasksPreamble(
    storage: AgentWebSessionStorage,
    paragraph: Extract<RootContent, {type: "paragraph"}>,
) {
    let children = paragraph.children;
    let pagination: AgentWebTaskSubtasksPage["pagination"] = null;
    const lastChild = children[children.length - 1];

    if (
        lastChild?.type === "link" &&
        printMarkdownPhrasingContentText(lastChild.children) ===
            agentWebTaskQueryPageNextPageLinkText
    ) {
        const {pathname, searchParams} = normalizeAgentWebPath(lastChild.url);
        const nextCursorHash = searchParams.get("after");
        const [pageLinkResult, filters, sorts] = await runAllPromises([
            routeAgentWebPageLinkPathname(storage, pathname),
            parseAgentWebTaskQueryFilters(storage, searchParams),
            parseAgentWebTaskQuerySorts(searchParams),
        ]);

        if (pageLinkResult?.pageLink.type !== "TaskSubtasks" || nextCursorHash === null) {
            throw createAgentWebTaskSubtasksPreambleError(paragraph);
        }

        pagination = {nextCursorHash, query: {filters, sorts}};

        children = children.slice(0, -1);
        const trailingText = children[children.length - 1];
        if (trailingText?.type === "text" && trailingText.value.endsWith(" ")) {
            children = [
                ...children.slice(0, -1),
                {...trailingText, value: trailingText.value.slice(0, -1)},
            ];
        }
    }

    if (children.length !== 2 && children.length !== 3) {
        throw createAgentWebTaskSubtasksPreambleError(paragraph);
    }
    const [prefix, taskLink, suffix] = children;
    if (
        prefix?.type !== "text" ||
        !/^Subtasks for\s+$/i.test(prefix.value) ||
        taskLink?.type !== "link" ||
        (suffix !== undefined && (suffix.type !== "text" || !/^\.?$/.test(suffix.value.trim())))
    ) {
        throw createAgentWebTaskSubtasksPreambleError(paragraph);
    }

    const task = await parseAgentWebTaskQueryPageTaskReference(storage, taskLink, "TaskSubtasks");

    return {
        task: {
            type: "Task" as const,
            id: task.taskId,
            title: task.title,
            status: task.status,
        },
        pagination,
    };
}

function createAgentWebTaskSubtasksPreambleError(node: RootContent | undefined) {
    return new InvalidArgumentError("Invalid task subtasks preamble", {
        displayMessage: errorDisplayMessage`Subtasks markdown must start with \u201cSubtasks for [My Task (Open)](/task/my-task).\u201d on line 1 (substitute \u201CMy Task\u201D for the task you\u2019re looking at the subtasks for). Try again with a valid task subtasks preamble${node?.position?.start.line ? ` on line ${node.position.start.line}` : ""}.`,
    });
}
