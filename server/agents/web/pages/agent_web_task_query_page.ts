import {CalendarDate, fromDate, toCalendarDate} from "@internationalized/date";
import {produce} from "immer";
import {Link, List, ListItem, RootContent} from "mdast";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {
    AgentWebPageStoredLink,
    printAgentWebPageStoredLinkLabel,
} from "~/server/agents/web/agent_web_page_stored_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {
    AgentWebTaskQueryId,
    createAgentWebTaskQueryCursorHash,
    getAgentWebTaskQueryCursorForHashIfExists,
} from "~/server/agents/web/agent_web_task_query_cursor_hash.js";
import {
    ApiTaskQueryFilterResponseWithoutAccountSpace,
    parseAgentWebTaskQueryFilters,
    printAgentWebTaskQueryFilters,
} from "~/server/agents/web/agent_web_task_query_filters.js";
import {
    parseAgentWebTaskQuerySorts,
    printAgentWebTaskQuerySorts,
} from "~/server/agents/web/agent_web_task_query_sorts.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {
    formatAgentWebTaskDueDateString,
    parseAgentWebTaskFieldListItems,
    printAgentWebTaskFieldListItems,
} from "~/server/agents/web/pages/agent_web_task_fields.js";
import {parseAgentWebTaskPageDueDateStringForUpdate} from "~/server/agents/web/pages/parse_agent_web_task_page_due_date_string_for_update.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {
    ApiAccountReferenceResponse,
    ApiTaskCollectionReferenceResponse,
    ApiTaskMoveInQueryPatchPosition,
    ApiTaskPatch,
    ApiTaskPriority,
    ApiTaskQuerySort,
    ApiTaskReferenceResponse,
    ApiTaskStatus,
    ApiTaskSubtasks,
    ApiTaskWithoutNotesResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {partitionArray} from "~/shared/helpers/array/partition_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {reverseIterable} from "~/shared/helpers/iterable/reverse_iterable.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

const agentWebTaskQueryPageApiTasksBatchCount = 31;

/** The link text used to paginate any task query page. */
export const agentWebTaskQueryPageNextPageLinkText = "Next page »";

/**
 * The maximum number of collections printed for a task in a task query page.
 */
const agentWebTaskQueryPageTaskMaxCollectionCount = 3;

/** Filters and sorts supplied through a task query page's URL search params. */
export type AgentWebTaskQueryPageQuery = {
    readonly filters: ReadonlyArray<ApiTaskQueryFilterResponseWithoutAccountSpace>;
    readonly sorts: ReadonlyArray<ApiTaskQuerySort>;
};

export type AgentWebTaskQueryPagePagination = {
    readonly nextCursorHash: string;
    readonly query: AgentWebTaskQueryPageQuery;
};

/** The task-list portion shared by collection and subtasks pages. */
export type AgentWebTaskQueryPage = {
    readonly pagination: AgentWebTaskQueryPagePagination | null;
    readonly isEndOfTasks: boolean;
    readonly tasks: ReadonlyArray<AgentWebTaskQueryPageTask>;
};

export type AgentWebTaskQueryPageTask = {
    readonly taskId: TaskId;
    readonly title: string;
    readonly status: ApiTaskStatus;
    readonly parent: ApiTaskReferenceResponse | null;
    readonly subtasks: ApiTaskSubtasks;
    readonly assignee: ApiAccountReferenceResponse | null;
    readonly collections: ReadonlyArray<ApiTaskCollectionReferenceResponse>;
    readonly additionalCollectionsCount: number;
    readonly priority: ApiTaskPriority | null;
    readonly dueDateString: string | null;
};

export type AgentWebTaskQueryPageMetadata = {
    /**
     * The cursor immediately before the first visible task on this page. Null if we're
     * at the start of the task list.
     */
    readonly afterCursor: ApiTaskQueryCursor | null;

    /**
     * The cursor immediately after the last task on this page. Null if we're at the
     * end of the task list. `isEndOfTasks` is also the same as
     * `beforeCursor === null`.
     */
    readonly beforeCursor: ApiTaskQueryCursor | null;

    /**
     * Is this task collection manually ordered? That means there's no automatic sorts
     * and you can freely drag-and-drop to reorder tasks.
     */
    readonly isManuallyOrdered: boolean;

    readonly tasks: ReadonlyArray<{
        readonly cursor: ApiTaskQueryCursor;
    }>;
};

export type AgentWebTaskQueryPageScope =
    | {
          readonly type: "TaskCollection";
          readonly id: TaskCollectionId;
          readonly name: string;
      }
    | {
          readonly type: "TaskSubtasks";
          readonly task: ApiTaskReferenceResponse;
      };

type AgentWebTaskQueryPageBatch<Resource> = {
    readonly resource: Resource;
    readonly isManuallyOrdered: boolean;
    readonly nextCursor: ApiTaskQueryCursor | null;
    readonly tasks: ReadonlyArray<{
        readonly cursor: ApiTaskQueryCursor;
        readonly task: ApiTaskWithoutNotesResponse;
    }>;
};

export function intoAgentWebTaskQueryPageTask({
    timeZone,
    contextDate,
    omittedCollectionId,
    omittedParentTaskId,
    task,
}: {
    timeZone: TimeZone;
    contextDate: CalendarDate;
    omittedCollectionId?: TaskCollectionId;
    omittedParentTaskId?: TaskId;
    task: ApiTaskWithoutNotesResponse;
}): AgentWebTaskQueryPageTask {
    const taskCollections = filterMapArray(
        task.collections ?? emptyArray,
        ({collection}): ApiTaskCollectionReferenceResponse | undefined => {
            if (collection.id === omittedCollectionId) return;

            return {
                type: "TaskCollection",
                id: collection.id,
                title: collection.name,
            };
        },
    );

    const parent = task.parent?.task;

    return {
        taskId: task.id,
        title: task.title,
        status: task.status,
        parent:
            parent && parent.id !== omittedParentTaskId
                ? {
                      type: "Task",
                      id: parent.id,
                      title: parent.title,
                      status: parent.status,
                  }
                : null,
        subtasks: task.subtasks,
        assignee: task.assignee ? intoApiAccountReference(task.assignee) : null,
        collections: taskCollections.slice(0, agentWebTaskQueryPageTaskMaxCollectionCount),
        additionalCollectionsCount: Math.max(
            taskCollections.length - agentWebTaskQueryPageTaskMaxCollectionCount,
            0,
        ),
        priority: task.priority ?? null,
        dueDateString: task.due
            ? formatAgentWebTaskDueDateString(timeZone, contextDate, task.due)
            : null,
    };
}

/**
 * Reads and length-limits the task-list portion of a task query page. The caller
 * supplies the query endpoint and wraps the shared list in its page preamble.
 */
export async function readAgentWebTaskQueryPage<Resource, Page extends AgentWebTaskQueryPage>(
    context: AgentWebContext,
    {
        pageLink,
        searchParams,
        limitLength,
        readTaskBatch,
        intoPageTask,
        buildPage,
        printPage,
    }: {
        pageLink: Extract<AgentWebPageLink, {type: "TaskCollection" | "TaskSubtasks"}>;
        searchParams: URLSearchParams;
        limitLength: number;
        readTaskBatch: (input: {
            cursor: ApiTaskQueryCursor | undefined;
            query: AgentWebTaskQueryPageQuery;
            limit: number;
        }) => Promise<AgentWebTaskQueryPageBatch<Resource>>;
        intoPageTask: (options: {
            task: ApiTaskWithoutNotesResponse;
            contextDate: CalendarDate;
        }) => AgentWebTaskQueryPageTask;
        buildPage: (options: {
            queryPage: AgentWebTaskQueryPage;
            resource: Resource;
            afterCursor: ApiTaskQueryCursor | null;
        }) => Page;
        printPage: (page: Page) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebTaskQueryPageMetadata}> {
    const contextTime = new Date();
    const contextDate = toCalendarDate(fromDate(contextTime, context.timeZone));

    // NOCOMMIT: Add an integration test when a bot tries to use a `cursor` with
    // different `sorts`. Or when an agent tries to use a `cursor` when the default
    // sorts change from underneath them.
    const {afterCursor, query} = await parseAgentWebTaskQueryPageSearchParams(
        context.storage,
        pageLink,
        searchParams,
    );

    const tasks: Array<AgentWebTaskQueryPageTask> = [];
    const taskMetadata: Array<{cursor: ApiTaskQueryCursor}> = [];
    let cursor = afterCursor ?? undefined;

    while (true) {
        const {
            resource,
            isManuallyOrdered,
            nextCursor,
            tasks: currentTaskBatch,
        } = await readTaskBatch({
            cursor,
            query,
            limit: agentWebTaskQueryPageApiTasksBatchCount,
        });

        const lookaheadTask =
            nextCursor === null
                ? null
                : assertExists(currentTaskBatch[currentTaskBatch.length - 1]);
        const visibleTaskBatch =
            lookaheadTask === null ? currentTaskBatch : currentTaskBatch.slice(0, -1);

        function appendTask({
            cursor: taskCursor,
            task,
        }: {
            cursor: ApiTaskQueryCursor;
            task: ApiTaskWithoutNotesResponse;
        }): void {
            tasks.push(intoPageTask({task, contextDate}));
            taskMetadata.push({cursor: taskCursor});
        }

        for (const task of visibleTaskBatch) appendTask(task);

        const pageNextCursor =
            lookaheadTask === null
                ? null
                : assertExists(assertExists(taskMetadata[taskMetadata.length - 1]).cursor);

        const queryPage: AgentWebTaskQueryPage = {
            pagination:
                pageNextCursor === null
                    ? null
                    : {
                          nextCursorHash: await createAgentWebTaskQueryCursorHash(
                              context.storage,
                              pageLink.type === "TaskCollection"
                                  ? `TaskCollection:${pageLink.id}`
                                  : `Task:${pageLink.task.id}`,
                              pageNextCursor,
                          ),
                          query,
                      },
            tasks: tasks.slice(),
            isEndOfTasks: lookaheadTask === null,
        };

        // Only the first page of a task collection prints the collection fields like the
        // color. Later pages read with an `?after` cursor print a short preamble instead.
        const page = buildPage({queryPage, resource, afterCursor});

        const metadata: AgentWebTaskQueryPageMetadata = {
            afterCursor,
            beforeCursor: lookaheadTask?.cursor ?? null,
            isManuallyOrdered,
            tasks: taskMetadata,
        };

        const response = await printPage(page);

        if (lookaheadTask !== null && response.length < limitLength) {
            assert(nextCursor !== null);
            appendTask(lookaheadTask);
            cursor = nextCursor;
            continue;
        }

        if (response.length <= limitLength) {
            return {response, metadata};
        }

        const truncatedResult = await truncateAgentWebTaskQueryPage(context.storage, {
            pageLink,
            page,
            metadata,
            query,
            limitLength,
            response,
        });

        if (truncatedResult === null) return {response, metadata};

        return truncatedResult;
    }
}

async function truncateAgentWebTaskQueryPage<Page extends AgentWebTaskQueryPage>(
    storage: AgentWebSessionStorage,
    {
        pageLink,
        page,
        metadata,
        query,
        limitLength,
        response,
    }: {
        pageLink: Extract<AgentWebPageLink, {type: "TaskCollection" | "TaskSubtasks"}>;
        page: Page;
        metadata: AgentWebTaskQueryPageMetadata;
        query: AgentWebTaskQueryPageQuery;
        limitLength: number;
        response: string;
    },
): Promise<{response: string; metadata: AgentWebTaskQueryPageMetadata} | null> {
    if (page.tasks.length <= 1) return null;
    assert(metadata.tasks.length === page.tasks.length);

    const limitLengthDifference = response.length - limitLength;
    assert(limitLengthDifference > 0);

    const responseTree = parseMarkdownTree(response);
    const taskList = responseTree.children.find((child): child is List => child.type === "list");

    if (taskList === undefined) return null;
    assert(taskList.children.length === page.tasks.length);

    let truncateLength = limitLengthDifference;
    let addedPaginationPath: {pathname: string; search: string} | null = null;

    // Edge case: if we need to add a pagination link then expect more to be truncated
    // so we can add the pagination link while still fitting into `limitLength`.
    if (page.pagination === null) {
        const [pathname, search] = await runAllPromises([
            createAgentWebPageLinkPathname(storage, pageLink),
            printAgentWebTaskQueryPageSearchParams(storage, {
                nextCursorHash: "0".repeat(agentWebTaskQueryCursorHashLength),
                query,
            }),
        ]);

        addedPaginationPath = {pathname, search};

        truncateLength +=
            // We need double newlines when adding after a previous block and a single space
            // when adding into a preamble. Given double newlines is the longer of the two use
            // that in our character count.
            "\n\n[".length +
            agentWebTaskQueryPageNextPageLinkText.length +
            "](".length +
            pathname.length +
            "?".length +
            search.length +
            ")".length;
    }

    let lastTaskEndOffset: number | null = null;
    let truncateTaskEndOffset: number | null = null;
    let truncateTaskCount = 0;

    for (const taskListItem of reverseIterable(taskList.children)) {
        const endOffset = assertExists(taskListItem.position?.end.offset);

        lastTaskEndOffset ??= endOffset;
        truncateTaskEndOffset = endOffset;
        truncateTaskCount++;

        if (lastTaskEndOffset - truncateTaskEndOffset >= truncateLength) break;
    }

    // We don't truncate the last task traverse sees.
    truncateTaskCount--;

    // There are no tasks in this page so we don't truncate.
    if (truncateTaskEndOffset === null) return null;

    // Always set when `truncateTaskEndOffset` is set.
    assert(lastTaskEndOffset !== null);

    // No truncation occurred!
    if (truncateTaskEndOffset === lastTaskEndOffset) return null;

    const truncatedTaskCount = page.tasks.length - truncateTaskCount;

    // There should always be at least one task left after we truncate.
    assert(truncatedTaskCount > 0);

    // The "Next page" link continues from the last task left after truncation.
    const nextCursorHash = await createAgentWebTaskQueryCursorHash(
        storage,
        pageLink.type === "TaskCollection"
            ? `TaskCollection:${pageLink.id}`
            : `Task:${pageLink.task.id}`,
        assertExists(metadata.tasks[truncatedTaskCount - 1]).cursor,
    );

    // We're intentionally dropping everything after `truncateTaskEndOffset`. Which
    // will include the "End of tasks." paragraph. If we're truncating then we're
    // implicitly not at the end of tasks anymore.
    let truncatedResponse = response.slice(0, truncateTaskEndOffset);

    // Update the "Next page" link to reflect the new last task cursor after
    // truncation.
    //
    // If there is no "Next page" link and truncation occurred then we need to add a
    // "Next page" link.
    if (page.pagination !== null) {
        // The link may be in its own paragraph or at the end of a preamble paragraph.
        // Either way it's a link in a root level paragraph.
        let paginationLink: Link | null = null;

        for (const child of responseTree.children) {
            if (child.type !== "paragraph") continue;

            for (const paragraphChild of child.children) {
                if (
                    paragraphChild.type === "link" &&
                    printMarkdownPhrasingContentText(paragraphChild.children) ===
                        agentWebTaskQueryPageNextPageLinkText
                ) {
                    paginationLink = paragraphChild;
                    break;
                }
            }

            if (paginationLink !== null) break;
        }

        assert(paginationLink !== null);

        const linkStartOffset = assertExists(paginationLink.position?.start.offset);
        const linkEndOffset = assertExists(paginationLink.position?.end.offset);

        assert(linkEndOffset <= truncatedResponse.length);

        truncatedResponse =
            truncatedResponse.slice(0, linkStartOffset) +
            response
                .slice(linkStartOffset, linkEndOffset)
                .replace(/([?&]after=)[^&)]+/, `$1${nextCursorHash}`) +
            truncatedResponse.slice(linkEndOffset);
    } else {
        assert(addedPaginationPath !== null);
        const placeholderCursorHash = "0".repeat(agentWebTaskQueryCursorHashLength);
        assert(addedPaginationPath.search.startsWith(`after=${placeholderCursorHash}`));

        const path = `${addedPaginationPath.pathname}?after=${nextCursorHash}${addedPaginationPath.search.slice(`after=${placeholderCursorHash}`.length)}`;

        const linkMarkdown = `[${agentWebTaskQueryPageNextPageLinkText}](${path})`;

        if (responseTree.children[0]?.type === "heading") {
            // The "Next page" link goes right after the node before the task list (the task
            // collection name heading or the color field for task collections).
            const taskListIndex = responseTree.children.indexOf(taskList);
            assert(taskListIndex > 0);

            const insertionOffset = assertExists(
                responseTree.children[taskListIndex - 1]!.position?.end.offset,
            );

            truncatedResponse =
                truncatedResponse.slice(0, insertionOffset) +
                "\n\n" +
                linkMarkdown +
                truncatedResponse.slice(insertionOffset);
        } else {
            // The "Next page" link goes at the end of the preamble paragraph.
            const preamble = responseTree.children[0];
            assert(preamble?.type === "paragraph");

            const insertionOffset = assertExists(preamble.position?.end.offset);

            truncatedResponse =
                truncatedResponse.slice(0, insertionOffset) +
                " " +
                linkMarkdown +
                truncatedResponse.slice(insertionOffset);
        }
    }

    return {
        response: truncatedResponse,
        metadata: {
            ...metadata,
            // Keep the first discarded task's cursor as the boundary after the page, but don't
            // expose the task itself.
            beforeCursor: assertExists(metadata.tasks[truncatedTaskCount]).cursor,

            tasks: metadata.tasks.slice(0, truncatedTaskCount),
        },
    };
}

async function parseAgentWebTaskQueryPageSearchParams(
    storage: AgentWebSessionStorage,
    pageLink: Extract<AgentWebPageLink, {type: "TaskCollection" | "TaskSubtasks"}>,
    searchParams: URLSearchParams,
): Promise<{
    afterCursor: ApiTaskQueryCursor | null;
    query: AgentWebTaskQueryPageQuery;
}> {
    const afterCursorHash = searchParams.get("after");

    const [afterCursor, filters, sorts] = await runAllPromises([
        (async () => {
            if (afterCursorHash === null) return null;

            const storedAfterCursor = await getAgentWebTaskQueryCursorForHashIfExists(
                storage,
                pageLink.type === "TaskCollection"
                    ? `TaskCollection:${pageLink.id}`
                    : `Task:${pageLink.task.id}`,
                afterCursorHash,
            );

            if (storedAfterCursor === undefined) {
                const pageNoun = {
                    TaskCollection: errorDisplayMessage`task collection`,
                    TaskSubtasks: errorDisplayMessage`task\u2019s subtasks`,
                }[pageLink.type];

                throw new InvalidArgumentError("Expected `after` search param to be a cursor", {
                    displayMessage: errorDisplayMessage`Expected \`?after\` URL search param to be a cursor from a ${pageNoun} page \u201c${agentWebTaskQueryPageNextPageLinkText}\u201d link. Try again with a \u201c${agentWebTaskQueryPageNextPageLinkText}\u201d link you\u2019ve seen before or omit \`?after\`.`,
                });
            }

            return storedAfterCursor;
        })(),
        parseAgentWebTaskQueryFilters(storage, searchParams),
        parseAgentWebTaskQuerySorts(searchParams),
    ]);

    return {afterCursor, query: {filters, sorts}};
}

export async function printAgentWebTaskQueryPageTaskListItem(
    storage: AgentWebSessionStorage,
    pageTask: AgentWebTaskQueryPageTask,
): Promise<ListItem> {
    const taskReference: ApiTaskReferenceResponse = {
        type: "Task",
        id: pageTask.taskId,
        title: pageTask.title,
        status: pageTask.status,
    };

    const [taskPathname, fieldListItems] = await runAllPromises([
        createAgentWebPageStoredLinkPathname(storage, taskReference),
        runAllPromises(
            printAgentWebTaskFieldListItems(storage, {
                parent: pageTask.parent,
                subtasks: pageTask.subtasks,
                assignee: pageTask.assignee,
                collections: pageTask.collections,
                additionalCollectionsCount: pageTask.additionalCollectionsCount,
                priority: pageTask.priority,
                dueDateString: pageTask.dueDateString,
            }),
        ),
    ]);

    const children: ListItem["children"] = [
        {
            type: "paragraph",
            children: [
                {
                    type: "link",
                    url: taskPathname,
                    children: [
                        {type: "text", value: printAgentWebPageStoredLinkLabel(taskReference)},
                    ],
                },
            ],
        },
    ];

    if (fieldListItems.length > 0) {
        children.push({
            type: "list",
            ordered: false,
            spread: false,
            children: fieldListItems,
        });
    }

    return {type: "listItem", spread: false, children};
}


async function parseAgentWebTaskQueryPageTask(
    storage: AgentWebSessionStorage,
    taskListItem: ListItem,
    pageType: "TaskCollection" | "TaskSubtasks",
): Promise<AgentWebTaskQueryPageTask> {
    const createError = () =>
        new InvalidArgumentError("Invalid task query task list item", {
            displayMessage: errorDisplayMessage`Unexpected markdown in the task list item on line ${taskListItem.position?.start.line ?? "unknown"}. Try again with a single task link (e.g. \`- [My Task (Open)](/task/my-task)\`) in each task list item, optionally followed by a nested list of task fields (e.g. \`- Priority: Medium\`).`,
        });

    const paragraph = taskListItem.children[0];
    if (paragraph?.type !== "paragraph") throw createError();

    let link: Link | null = null;

    for (const child of paragraph.children) {
        if (child.type === "link" && link === null) {
            link = child;
            continue;
        }

        if (child.type === "text" && child.value.trim().length === 0) {
            continue;
        }

        throw createError();
    }

    if (link === null) throw createError();

    // The task link paragraph may be followed by a single nested unordered list
    // holding the task's fields.
    let fieldList: List | null = null;
    const secondChild = taskListItem.children[1];

    if (taskListItem.children.length > 2) throw createError();

    if (secondChild !== undefined) {
        if (secondChild.type !== "list" || secondChild.ordered) throw createError();
        fieldList = secondChild;
    }

    const [taskReference, fields] = await runAllPromises([
        parseAgentWebTaskQueryPageTaskReference(storage, link, pageType),
        fieldList !== null
            ? parseAgentWebTaskFieldListItems(storage, fieldList.children, [
                  "parent",
                  "subtasks",
                  "assignee",
                  "collections",
                  "additionalCollectionsCount",
                  "priority",
                  "dueDateString",
              ])
            : null,
    ]);

    return {
        taskId: taskReference.taskId,
        title: taskReference.title,
        status: taskReference.status,
        parent: fields?.parent ?? null,
        subtasks: fields?.subtasks ?? {openTaskCount: 0, closedTaskCount: 0},
        assignee: fields?.assignee ?? null,
        collections: fields?.collections ?? [],
        additionalCollectionsCount: fields?.additionalCollectionsCount ?? 0,
        priority: fields?.priority ?? null,
        dueDateString: fields?.dueDateString ?? null,
    };
}

export async function parseAgentWebTaskQueryPageTaskReference(
    storage: AgentWebSessionStorage,
    link: Link,
    pageType: "TaskCollection" | "TaskSubtasks",
): Promise<{
    // NOTE(calebmer): Intentionally returns this type that's not compatible with
    // `ApiTaskReferenceResponse` because unlike when we usually parse
    // `ApiTaskReferenceResponse` (via `routeAgentWebPageLinkPathname()`) we parse the
    // title and status directly from the task label. Normally we ignore the link label
    // and only parse using the link URL. This "exploded" format we hope helps the
    // consuming code think about handling the `title`/`status` differently, as data
    // instead of derived response properties.
    taskId: TaskId;
    status: ApiTaskStatus;
    title: string;
}> {
    const pageLinkResult = await routeAgentWebPageLinkPathname(storage, link.url);

    if (!pageLinkResult || pageLinkResult.pageLink.type !== "Task") {
        const quotedValue = quoteMarkdown([link]);
        throw new InvalidArgumentError("Unknown task link in task query", {
            displayMessage: errorDisplayMessage`Couldn\u2019t find a task for the link ${quotedValue} on line ${link.position?.start.line ?? "unknown"}. You may only add a task you\u2019ve previously seen to ${{TaskCollection: errorDisplayMessage`a collection`, TaskSubtasks: errorDisplayMessage`subtasks`}[pageType]}. Try calling the \`create\` tool to create a new task and then add that new task to ${{TaskCollection: errorDisplayMessage`the collection`, TaskSubtasks: errorDisplayMessage`the subtasks`}[pageType]}, or try calling the \`search\` tool to find an existing task you want to add to ${{TaskCollection: errorDisplayMessage`the collection`, TaskSubtasks: errorDisplayMessage`the subtasks`}[pageType]}.`,
        });
    }

    const label = printMarkdownPhrasingContentText(link.children);
    const statusMatch = label.match(/^([\s\S]*) \((open|open, active|open, inactive|closed)\)$/i);

    if (statusMatch === null) {
        throw new InvalidArgumentError("Missing status in task query task link label", {
            displayMessage: errorDisplayMessage`Missing status at the end of task link label on line ${link.position?.start.line ?? "unknown"}. Task link labels must end with \u201c (Open)\u201d, \u201c (Open, active)\u201d, or \u201c (Closed)\u201d. Try again with a task link like \`[My Task (Open)](/task/my-task)\`.`,
        });
    }

    const statusText = statusMatch[2]!.toLowerCase() as
        | "open"
        | "open, active"
        | "open, inactive"
        | "closed";
    let status: ApiTaskStatus;

    switch (statusText) {
        case "open":
        case "open, inactive":
            status = {type: "Open", isActive: false};
            break;
        case "open, active":
            status = {type: "Open", isActive: true};
            break;
        case "closed":
            status = {type: "Closed"};
            break;
        default:
            throw exhaustive(statusText);
    }

    return {
        taskId: pageLinkResult.pageLink.id,
        title: statusMatch[1]!,
        status,
    };
}

export function normalizeAgentWebTaskQueryPage<Page extends AgentWebTaskQueryPage>(
    page: Page,
): Page {
    return produce(page, page => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            for (const pageTask of page.tasks) {
                if (pageTask.parent) normalizer.normalizeReference(pageTask.parent);
                if (pageTask.assignee) normalizer.normalizeReference(pageTask.assignee);
                for (const collection of pageTask.collections)
                    normalizer.normalizeReference(collection);
            }
        });
    });
}

    const contextTime = new Date();
    const contextDate = toCalendarDate(fromDate(contextTime, context.timeZone));

    if (!isDeepEqual(oldPage.pagination, newPage.pagination)) {
        throw new InvalidArgumentError("Can\u2019t update task query pagination", {
            displayMessage: errorDisplayMessage`You can\u2019t update the \u201c${agentWebTaskQueryPageNextPageLinkText}\u201d link in ${{TaskCollection: errorDisplayMessage`task collection`, TaskSubtasks: errorDisplayMessage`subtasks`}[scope.type]} markdown. Try again with a more specific update that leaves the \u201c${agentWebTaskQueryPageNextPageLinkText}\u201d link unchanged.`,
        });
    }

    // The end of tasks marker is optional for a page that's actually at the end of
    // tasks (according to metadata). However, for a page that's not at the end of
    // tasks you can't add the end of tasks marker!
    if (oldPageMetadata.beforeCursor !== null && newPage.isEndOfTasks) {
        throw new InvalidArgumentError("Can\u2019t change whether this page is the end of tasks", {
            displayMessage: errorDisplayMessage`Can\u2019t add the \u201cEnd of tasks\u201d marker in an update. Only a \`read\` tool call can tell you whether you\u2019re at the end of a task list or not. Try again without adding the \u201cEnd of tasks\u201d marker.`,
        });
    }

    const oldTaskIds = new Set<TaskId>();
    const newTaskIds = new Set<TaskId>();

    // NOCOMMIT: Integration test where we shuffle task collection tasks and make sure
    // after the API calls the resulting task order is correct with another read.
    //
    // NOCOMMIT: Lots of integration tests for moving tasks then also adding tasks at
    // the same time (nearby). Also moving tasks in one `update` call and then making
    // another `update` call that makes more moves.
    for (const oldTask of oldPage.tasks) {
        assert(!oldTaskIds.has(oldTask.taskId));
        oldTaskIds.add(oldTask.taskId);
    }

    for (const newTask of newPage.tasks) {
        if (!newTaskIds.has(newTask.taskId)) {
            newTaskIds.add(newTask.taskId);
            continue;
        }

        const quotedTitle = quoteMarkdown([{type: "text", value: newTask.title}]);

        throw new InvalidArgumentError("Duplicate task in task query page", {
            displayMessage: errorDisplayMessage`The task ${quotedTitle} appears more than once on this ${{TaskCollection: errorDisplayMessage`task collection`, TaskSubtasks: errorDisplayMessage`subtasks`}[scope.type]} page. Each task may only appear once. Try again after removing the duplicate task link.`,
        });
    }

    const [oldCommonTaskIds, removedTaskIds] = partitionArray(oldTaskIds, taskId =>
        newTaskIds.has(taskId),
    );
    const [newCommonTaskIds, addedTaskIds] = partitionArray(newTaskIds, taskId =>
        oldTaskIds.has(taskId),
    );

    // Find the longest common task subsequence. Tasks outside the subsequence are the
    // smallest set of existing tasks that must move to produce the new order.
    const commonSubsequenceLengths = createArrayWithLength(oldCommonTaskIds.length + 1, () =>
        createArrayWithLength(newCommonTaskIds.length + 1, () => 0),
    );

    // NOTE(calebmer): This was written by GPT-5.6 and I'll be honest, I don't fully
    // understand the algorithm. But it works to produce the minimal set of move
    // patches and even though it's O(n^2) n will be small in this context.
    for (let oldIndex = oldCommonTaskIds.length - 1; oldIndex >= 0; oldIndex--) {
        for (let newIndex = newCommonTaskIds.length - 1; newIndex >= 0; newIndex--) {
            commonSubsequenceLengths[oldIndex]![newIndex] =
                oldCommonTaskIds[oldIndex] === newCommonTaskIds[newIndex]
                    ? commonSubsequenceLengths[oldIndex + 1]![newIndex + 1]! + 1
                    : Math.max(
                          commonSubsequenceLengths[oldIndex + 1]![newIndex]!,
                          commonSubsequenceLengths[oldIndex]![newIndex + 1]!,
                      );
        }
    }

    const stableTaskIds = new Set<TaskId>();
    let oldCommonTaskIndex = 0;
    let newCommonTaskIndex = 0;

    while (
        oldCommonTaskIndex < oldCommonTaskIds.length &&
        newCommonTaskIndex < newCommonTaskIds.length
    ) {
        const oldTaskId = oldCommonTaskIds[oldCommonTaskIndex]!;
        const newTaskId = newCommonTaskIds[newCommonTaskIndex]!;

        if (oldTaskId === newTaskId) {
            stableTaskIds.add(oldTaskId);
            oldCommonTaskIndex++;
            newCommonTaskIndex++;
        } else if (
            commonSubsequenceLengths[oldCommonTaskIndex + 1]![newCommonTaskIndex]! >=
            commonSubsequenceLengths[oldCommonTaskIndex]![newCommonTaskIndex + 1]!
        ) {
            oldCommonTaskIndex++;
        } else {
            newCommonTaskIndex++;
        }
    }

    const movedTaskIds = new Set(
        filterIterable(newCommonTaskIds, taskId => !stableTaskIds.has(taskId)),
    );

    if (!oldPageMetadata.isManuallyOrdered) {
        if (addedTaskIds.length > 0) {
            throw new InvalidArgumentError(
                "Can\u2019t add tasks in an automatically ordered query",
                {
                    displayMessage: errorDisplayMessage`Tasks may only be added to ${{TaskCollection: errorDisplayMessage`task collection`, TaskSubtasks: errorDisplayMessage`subtasks`}[scope.type]} markdown when the ${{TaskCollection: errorDisplayMessage`collection is`, TaskSubtasks: errorDisplayMessage`subtasks are`}[scope.type]} sorted manually. ${{TaskCollection: errorDisplayMessage`A collection is`, TaskSubtasks: errorDisplayMessage`Subtasks are`}[scope.type]} manually sorted when no automatic sorts are applied. That means there are no default sorts/filters and there is no \`?sort\` (or filter) in the path passed to the \`read\` tool. To add tasks to ${{TaskCollection: errorDisplayMessage`an automatically sorted collection`, TaskSubtasks: errorDisplayMessage`automatically sorted subtasks`}[scope.type]}, use the \`read\` tool to read an individual task and ${{TaskCollection: errorDisplayMessage`add a collection to the task\u2019s \u201cCollections\u201d field`, TaskSubtasks: errorDisplayMessage`set the parent in the task\u2019s \u201cParent\u201d field`}[scope.type]} with the \`update\` tool. Try again without adding new tasks.`,
                },
            );
        }
        if (movedTaskIds.size > 0) {
            throw new InvalidArgumentError(
                "Can\u2019t move tasks in an automatically ordered query",
                {
                    displayMessage: errorDisplayMessage`Tasks may only be reordered in ${{TaskCollection: errorDisplayMessage`task collection`, TaskSubtasks: errorDisplayMessage`subtasks`}[scope.type]} markdown when the ${{TaskCollection: errorDisplayMessage`collection is`, TaskSubtasks: errorDisplayMessage`subtasks are`}[scope.type]} sorted manually. ${{TaskCollection: errorDisplayMessage`A collection is`, TaskSubtasks: errorDisplayMessage`Subtasks are`}[scope.type]} manually sorted when no automatic sorts are applied. That means there are no default sorts/filters and there is no \`?sort\` (or filter) in the path passed to the \`read\` tool. To reorder tasks in ${{TaskCollection: errorDisplayMessage`an automatically sorted collection`, TaskSubtasks: errorDisplayMessage`automatically sorted subtasks`}[scope.type]}, look at the ${{TaskCollection: errorDisplayMessage`collection\u2019s`, TaskSubtasks: errorDisplayMessage`task\u2019s subtasks`}[scope.type]} sorts and update the corresponding fields in the task (for example, if ${{TaskCollection: errorDisplayMessage`a collection is`, TaskSubtasks: errorDisplayMessage`subtasks are`}[scope.type]} sorted by \`?sort=priority\` then updating a task\u2019s priority will move it). If you are updating a task\u2019s fields in ${{TaskCollection: errorDisplayMessage`an automatically sorted collection`, TaskSubtasks: errorDisplayMessage`automatically sorted subtasks`}[scope.type]}, you shouldn\u2019t move the task yourself with the \`update\` tool because the task will be moved automatically. Instead read the ${{TaskCollection: errorDisplayMessage`collection`, TaskSubtasks: errorDisplayMessage`subtasks`}[scope.type]} again with the \`read\` tool after your update to see the new order. Try again without reordering tasks.`,
                },
            );
        }
    }

    assert(oldPageMetadata.tasks.length === oldPage.tasks.length);

    const oldTaskCursorById = new Map(
        oldPage.tasks.map((pageTask, index) => [
            pageTask.taskId,
            assertExists(oldPageMetadata.tasks[index]).cursor,
        ]),
    );
    const oldPageTaskById = new Map(oldPage.tasks.map(pageTask => [pageTask.taskId, pageTask]));
    const newPageTaskById = new Map(newPage.tasks.map(pageTask => [pageTask.taskId, pageTask]));
    const taskPatchInputs: Array<{id: TaskId; patch: ApiTaskPatch}> = [];
