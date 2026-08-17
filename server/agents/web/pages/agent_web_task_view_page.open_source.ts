import {produce} from "immer";
import {List, Root, RootContent} from "mdast";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {parseAgentWebTaskQueryFilters} from "~/server/agents/web/agent_web_task_query_filters.open_source.js";
import {parseAgentWebTaskQuerySorts} from "~/server/agents/web/agent_web_task_query_sorts.open_source.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.open_source.js";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.open_source.js";
import {
    AgentWebTaskQueryPage,
    AgentWebTaskQueryPageMetadata,
    agentWebTaskQueryPageNextPageLinkText,
    intoAgentWebTaskQueryPageTask,
    normalizeAgentWebTaskQueryPage,
    parseAgentWebTaskQueryPageTasks,
    printAgentWebTaskQueryPageSearchParams,
    printAgentWebTaskQueryPageTaskList,
    readAgentWebTaskQueryPage,
    updateAgentWebTaskQueryPage,
} from "~/server/agents/web/pages/agent_web_task_query_page.open_source.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.open_source.js";
import {printMarkdownPhrasingContentText} from "~/shared/api/content/print_markdown_phrasing_content_text.open_source.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";

/** An untitled, URL-defined view of tasks in the current space. */
export type AgentWebTaskViewPage = AgentWebTaskQueryPage & {
    readonly type: "TaskView";
};

export type AgentWebTaskViewPageMetadata = AgentWebTaskQueryPageMetadata & {
    readonly type: "TaskView";
};

export type AgentWebTaskViewPageWithMetadata = AgentWebTaskViewPage & {
    readonly metadata: AgentWebTaskViewPageMetadata;
};

export async function readAgentWebTaskViewPage(
    context: AgentWebContext,
    {
        searchParams,
        limitLength,
        printPage,
    }: {
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebTaskViewPage) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebTaskViewPageMetadata}> {
    const result = await readAgentWebTaskQueryPage<null, AgentWebTaskViewPage>(context, {
        pageLink: {type: "TaskView"},
        searchParams,
        limitLength,
        readTaskBatch: async ({cursor, query, limit}) => {
            const tasksResult = await context.api.post(context.span, "/tasks-query", {
                body: {
                    spaceId: context.spaceId,
                    limit,
                    cursor,
                    filters: query.filters,
                    sorts: query.sorts,
                },
            });

            return {
                pageLink: {type: "TaskView"},
                resource: null,
                // Untitled task views have no manual membership or position to update.
                isManuallyOrdered: false,
                nextCursor: tasksResult.data.nextCursor,
                tasks: tasksResult.data.tasks,
            };
        },
        intoPageTask: ({task, contextDate}) =>
            intoAgentWebTaskQueryPageTask({
                timeZone: context.timeZone,
                contextDate,
                task,
            }),
        buildPage: ({queryPage}): AgentWebTaskViewPage => ({
            type: "TaskView",
            ...queryPage,
        }),
        printPage,
    });

    return {
        response: result.response,
        metadata: {...result.metadata, type: "TaskView"},
    };
}

export function normalizeAgentWebTaskViewPage<Page extends AgentWebTaskViewPage>(page: Page): Page {
    return produce(page, page => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            normalizeAgentWebTaskQueryPage(normalizer, page);
        });
    });
}

export async function updateAgentWebTaskViewPage(
    context: AgentWebContext,
    oldPageMetadata: AgentWebTaskViewPageMetadata,
    oldPage: AgentWebTaskViewPage,
    newPage: AgentWebTaskViewPage,
    {addAdditionalOutput}: {addAdditionalOutput: (output: string) => void},
): Promise<AgentWebTaskViewPageMetadata> {
    const {execute} = await updateAgentWebTaskQueryPage(
        context,
        {type: "TaskView"},
        oldPageMetadata,
        oldPage,
        newPage,
        {addAdditionalOutput},
    );

    return {...(await execute({type: "TaskView"})), type: "TaskView"};
}

export async function printAgentWebTaskViewPage(
    storage: AgentWebSessionStorage,
    pageLink: null,
    page: AgentWebTaskViewPage,
): Promise<Root> {
    const children: Array<RootContent> = [];
    const [paginationSearch, taskList] = await runAllPromises([
        page.pagination === null
            ? Promise.resolve(null)
            : printAgentWebTaskQueryPageSearchParams(storage, page.pagination),
        printAgentWebTaskQueryPageTaskList(storage, "TaskView", page.tasks),
    ]);

    children.push({
        type: "heading",
        depth: 1,
        children: [{type: "text", value: "Untitled"}],
    });

    if (paginationSearch !== null) {
        children.push({
            type: "paragraph",
            children: [
                {
                    type: "link",
                    url: `/task-view?${paginationSearch}`,
                    children: [{type: "text", value: agentWebTaskQueryPageNextPageLinkText}],
                },
            ],
        });
    }

    if (taskList !== null) children.push(taskList);

    if (page.isEndOfTasks) {
        children.push({
            type: "paragraph",
            children: [{type: "text", value: "End of tasks."}],
        });
    }

    return {type: "root", children};
}

export async function parseAgentWebTaskViewPage(
    storage: AgentWebSessionStorage,
    pageLink: null,
    root: Root,
): Promise<AgentWebTaskViewPage> {
    const heading = root.children[0];
    if (
        heading?.type !== "heading" ||
        heading.depth !== 1 ||
        printMarkdownPhrasingContentText(heading.children) !== "Untitled"
    ) {
        throw new InvalidArgumentError("Invalid task view heading", {
            displayMessage: errorDisplayMessage`Expected \u201c# Untitled\u201d on line ${heading?.position?.start.line ?? "unknown"}. Try again without changing the task view heading.`,
        });
    }

    let paginationParagraph: Extract<RootContent, {type: "paragraph"}> | null = null;
    let taskList: List | null = null;
    let isEndOfTasks = false;

    for (const child of root.children.slice(1)) {
        if (isEndOfTasks) {
            throw new InvalidArgumentError("Content after end of task view", {
                displayMessage: errorDisplayMessage`Nothing may appear after \u201cEnd of tasks\u201d in task view markdown. Try again after removing the extra content after \u201cEnd of tasks\u201d on line ${child.position?.start.line ?? "unknown"}.`,
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

        if (child.type === "paragraph" && paginationParagraph === null && taskList === null) {
            paginationParagraph = child;
            continue;
        }

        throw new InvalidArgumentError("Unexpected markdown in task view", {
            displayMessage: errorDisplayMessage`Unexpected markdown on line ${child.position?.start.line ?? "unknown"}. Try again with \u201c# Untitled\u201d on line 1, optionally followed by a \u201c${agentWebTaskQueryPageNextPageLinkText}\u201d link for pagination, and then a task list (an unordered list where every item is a task link).`,
        });
    }

    const [pagination, tasks] = await runAllPromises([
        paginationParagraph === null
            ? Promise.resolve(null)
            : parseAgentWebTaskViewPagination(storage, paginationParagraph),
        parseAgentWebTaskQueryPageTasks(storage, "TaskView", taskList),
    ]);

    return {type: "TaskView", pagination, tasks, isEndOfTasks};
}

async function parseAgentWebTaskViewPagination(
    storage: AgentWebSessionStorage,
    paragraph: Extract<RootContent, {type: "paragraph"}>,
): Promise<NonNullable<AgentWebTaskViewPage["pagination"]>> {
    const link = paragraph.children[0];

    if (
        paragraph.children.length !== 1 ||
        link?.type !== "link" ||
        printMarkdownPhrasingContentText(link.children) !== agentWebTaskQueryPageNextPageLinkText
    ) {
        throw createAgentWebTaskViewPaginationError(paragraph);
    }

    const {pathname, searchParams} = normalizeAgentWebPath(link.url);
    const nextCursorHash = searchParams.get("after");
    const [pageLinkResult, filters, sorts] = await runAllPromises([
        routeAgentWebPageLinkPathname(storage, pathname),
        parseAgentWebTaskQueryFilters(storage, searchParams),
        parseAgentWebTaskQuerySorts(searchParams),
    ]);

    if (pageLinkResult?.pageLink.type !== "TaskView" || nextCursorHash === null) {
        throw createAgentWebTaskViewPaginationError(paragraph);
    }

    return {nextCursorHash, query: {filters, sorts}};
}

function createAgentWebTaskViewPaginationError(node: RootContent) {
    return new InvalidArgumentError("Invalid task view pagination", {
        displayMessage: errorDisplayMessage`Expected a \u201c${agentWebTaskQueryPageNextPageLinkText}\u201d link for pagination on line ${node.position?.start.line ?? "unknown"}. Try again without changing the task view pagination link.`,
    });
}
