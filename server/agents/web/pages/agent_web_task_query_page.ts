import {CalendarDate, fromDate, toCalendarDate} from "@internationalized/date";
import {Link, List, ListItem, Node} from "mdast";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {
    agentWebTaskQueryCursorHashLength,
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
import {createAgentWebPageLinkPathname} from "~/server/agents/web/create_agent_web_page_link_pathname.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {curlyQuote} from "~/server/agents/web/internal/curly_quote.js";
import {
    formatAgentWebTaskDueDateString,
    parseAgentWebTaskFieldListItems,
    printAgentWebTaskFieldListItems,
} from "~/server/agents/web/pages/agent_web_task_fields.js";
import {parseAgentWebTaskPageDueDateStringForUpdate} from "~/server/agents/web/pages/parse_agent_web_task_page_due_date_string_for_update.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {ApiContentNormalizer} from "~/shared/api/content/normalize_api_content.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {
    ApiAccountReferenceResponse,
    ApiTaskBatchPatch,
    ApiTaskCollectionReferenceResponse,
    ApiTaskCreateRequest,
    ApiTaskMoveInQueryPatchPosition,
    ApiTaskPatch,
    ApiTaskPriority,
    ApiTaskQuerySort,
    ApiTaskReferenceResponse,
    ApiTaskResponse,
    ApiTaskStatus,
    ApiTaskSubtasks,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
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
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {reverseIterable} from "~/shared/helpers/iterable/reverse_iterable.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {Replace} from "~/shared/helpers/types/replace.js";
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

/**
 * Pagination for a task query page which is printed as a "Next page »" link.
 * `nextCursorHash` is the short hash for the full `ApiTaskQueryCursor` of the last
 * task on the page (see `createAgentWebTaskQueryCursorHash()`). A custom `query`
 * is preserved in the next page link so filtered and sorted task collection reads
 * can paginate.
 */
export type AgentWebTaskQueryPagePagination = {
    readonly nextCursorHash: string;
    readonly query: AgentWebTaskQueryPageQuery;
};

/**
 * The task-list portion shared by collection and subtasks pages.
 */
export type AgentWebTaskQueryPage = {
    readonly pagination: AgentWebTaskQueryPagePagination | null;
    readonly isEndOfTasks: boolean;
    readonly tasks: ReadonlyArray<AgentWebTaskQueryPageTask>;
};

/**
 * A task in a task query page. The task title is printed as a list item, linked
 * when `taskId` is present, with a subset of task fields nested under it.
 */
export type AgentWebTaskQueryPageTask = {
    readonly taskId: TaskId | null;
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

        /**
         * The ID created for a link-less task. This lets a later update to the same stored
         * response update the created task instead of creating it again.
         */
        readonly newTaskId: TaskId | null;
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
    task: ApiTaskResponse;
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
        pageLink:
            | {type: "TaskCollection"; id: TaskCollectionId}
            | {type: "TaskSubtasks"; task: {id: TaskId}};
        searchParams: URLSearchParams;
        limitLength: number;
        readTaskBatch: (input: {
            cursor: ApiTaskQueryCursor | undefined;
            query: AgentWebTaskQueryPageQuery;
            limit: number;
        }) => Promise<{
            pageLink: Extract<AgentWebPageLink, {type: "TaskCollection" | "TaskSubtasks"}>;
            resource: Resource;
            isManuallyOrdered: boolean;
            nextCursor: ApiTaskQueryCursor | null;
            tasks: ReadonlyArray<{
                cursor: ApiTaskQueryCursor;
                task: ApiTaskResponse;
            }>;
        }>;
        intoPageTask: (options: {
            task: ApiTaskResponse;
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
    const taskMetadata: Array<{
        cursor: ApiTaskQueryCursor;
        newTaskId: TaskId | null;
    }> = [];
    let cursor = afterCursor ?? undefined;

    while (true) {
        const {
            pageLink: fullPageLink,
            resource,
            isManuallyOrdered,
            nextCursor,
            tasks: currentTaskBatch,
        } = await readTaskBatch({
            cursor,
            query,
            limit: agentWebTaskQueryPageApiTasksBatchCount,
        });

        assert(pageLink.type === fullPageLink.type);

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
            task: ApiTaskResponse;
        }): void {
            tasks.push(intoPageTask({task, contextDate}));
            taskMetadata.push({cursor: taskCursor, newTaskId: null});
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
            pageLink: fullPageLink,
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
    pageLink:
        | {type: "TaskCollection"; id: TaskCollectionId}
        | {type: "TaskSubtasks"; task: {id: TaskId}},
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
                    displayMessage: errorDisplayMessage`Expected \`?after\` URL search param to be a cursor from a ${pageNoun} page \u201C${agentWebTaskQueryPageNextPageLinkText}\u201D link. Try again with a \u201C${agentWebTaskQueryPageNextPageLinkText}\u201D link you\u2019ve seen before or omit \`?after\`.`,
                });
            }

            return storedAfterCursor;
        })(),
        parseAgentWebTaskQueryFilters(storage, searchParams),
        parseAgentWebTaskQuerySorts(searchParams),
    ]);

    return {afterCursor, query: {filters, sorts}};
}

export async function printAgentWebTaskQueryPageSearchParams(
    storage: AgentWebSessionStorage,
    pagination: AgentWebTaskQueryPagePagination,
): Promise<string> {
    const filters = await printAgentWebTaskQueryFilters(storage, pagination.query.filters);

    return [
        `after=${pagination.nextCursorHash}`,
        filters,
        printAgentWebTaskQuerySorts(pagination.query.sorts),
    ]
        .filter(searchParams => searchParams.length > 0)
        .join("&");
}

export async function printAgentWebTaskQueryPageTaskList(
    storage: AgentWebSessionStorage,
    tasks: ReadonlyArray<AgentWebTaskQueryPageTask>,
): Promise<List | null> {
    if (tasks.length === 0) return null;

    return {
        type: "list",
        ordered: false,
        spread: true,
        children: await runAllPromises(
            tasks.map(task => printAgentWebTaskQueryPageTaskListItem(storage, task)),
        ),
    };
}

export async function printAgentWebTaskQueryPageTaskListItem(
    storage: AgentWebSessionStorage,
    pageTask: AgentWebTaskQueryPageTask,
): Promise<ListItem> {
    const taskReference: ApiTaskReferenceResponse | null =
        pageTask.taskId === null
            ? null
            : {
                  type: "Task",
                  id: pageTask.taskId,
                  title: pageTask.title,
                  status: pageTask.status,
              };

    const [taskPathname, fieldListItems] = await runAllPromises([
        taskReference === null
            ? null
            : createAgentWebPageStoredLinkPathname(storage, taskReference),
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

    const taskLabel = `${pageTask.title} ${pageTask.status.type === "Open" ? (pageTask.status.isActive ? "(Open, active)" : "(Open)") : "(Closed)"}`;

    const children: ListItem["children"] = [
        {
            type: "paragraph",
            children:
                taskPathname === null
                    ? [{type: "text", value: taskLabel}]
                    : [
                          {
                              type: "link",
                              url: taskPathname,
                              children: [{type: "text", value: taskLabel}],
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

export function parseAgentWebTaskQueryPageTasks(
    storage: AgentWebSessionStorage,
    pageType: "TaskCollection" | "TaskSubtasks",
    taskList: List | null,
): Promise<ReadonlyArray<AgentWebTaskQueryPageTask>> {
    if (taskList === null) return Promise.resolve([]);

    return runAllPromises(
        taskList.children.map(taskListItem =>
            parseAgentWebTaskQueryPageTask(storage, pageType, taskListItem),
        ),
    );
}

async function parseAgentWebTaskQueryPageTask(
    storage: AgentWebSessionStorage,
    pageType: "TaskCollection" | "TaskSubtasks",
    taskListItem: ListItem,
): Promise<AgentWebTaskQueryPageTask> {
    const createError = () =>
        new InvalidArgumentError("Invalid task query task list item", {
            displayMessage: errorDisplayMessage`Unexpected markdown in the task list item on line ${taskListItem.position?.start.line ?? "unknown"}. Try again with a single task link (e.g. \`- [My Task (Open)](/task/my-task)\`) in each task list item, optionally followed by a nested list of task fields (e.g. \`- Priority: Medium\`).`,
        });

    const paragraph = taskListItem.children[0];
    if (paragraph?.type !== "paragraph") throw createError();

    let link: Link | null = null;
    let hasNonWhitespaceText = false;

    for (const child of paragraph.children) {
        if (child.type === "link" && link === null) {
            link = child;
            continue;
        }

        if (child.type === "text" && child.value.trim().length === 0) {
            continue;
        }

        if (child.type === "text") {
            hasNonWhitespaceText = true;
            continue;
        }

        throw createError();
    }

    if (link !== null && hasNonWhitespaceText) throw createError();

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
        link === null
            ? {
                  taskId: null,
                  ...parseAgentWebTaskQueryPageTaskLabel(
                      taskListItem.position,
                      printMarkdownPhrasingContentText(paragraph.children),
                  ),
              }
            : parseAgentWebTaskQueryPageTaskReference(storage, link, pageType),
        fieldList !== null
            ? parseAgentWebTaskFieldListItems(storage, fieldList.children, [
                  "parent",
                  // NOCOMMIT: Can we not require subtasks when adding a task to a collection? Maybe
                  // `additionalCollectionsCount` too?
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
        const quotedValue = curlyQuote([link]);

        throw new InvalidArgumentError("Unknown task link in task query", {
            displayMessage: errorDisplayMessage`Couldn\u2019t find a task for the link ${quotedValue} on line ${link.position?.start.line ?? "unknown"}. You may only add a task you\u2019ve previously seen to ${{TaskCollection: errorDisplayMessage`a collection`, TaskSubtasks: errorDisplayMessage`subtasks`}[pageType]}. Try calling the \`create\` tool to create a new task and then add that new task to ${{TaskCollection: errorDisplayMessage`the collection`, TaskSubtasks: errorDisplayMessage`the subtasks`}[pageType]}, or try calling the \`search\` tool to find an existing task you want to add to ${{TaskCollection: errorDisplayMessage`the collection`, TaskSubtasks: errorDisplayMessage`the subtasks`}[pageType]}.`,
        });
    }

    return {
        taskId: pageLinkResult.pageLink.id,
        ...parseAgentWebTaskQueryPageTaskLabel(
            link.position,
            printMarkdownPhrasingContentText(link.children),
        ),
    };
}

function parseAgentWebTaskQueryPageTaskLabel(
    position: Node["position"],
    label: string,
): {status: ApiTaskStatus; title: string} {
    const statusMatch = label.match(/^([\s\S]*) \((open|open, active|open, inactive|closed)\)$/i);

    if (statusMatch === null) {
        throw new InvalidArgumentError("Missing status in task query task label", {
            displayMessage: errorDisplayMessage`Missing status at the end of task label on line ${position?.start.line ?? "unknown"}. Task labels must end with \u201C (Open)\u201D, \u201C (Open, active)\u201D, or \u201C (Closed)\u201D. Try again with a task label like \u201CMy Task (Open)\u201D.`,
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

    return {title: statusMatch[1]!, status};
}

export function normalizeAgentWebTaskQueryPage(
    normalizer: ApiContentNormalizer,
    page: Pick<AgentWebTaskQueryPage, "tasks">,
) {
    for (const pageTask of page.tasks) {
        if (pageTask.parent) normalizer.normalizeReference(pageTask.parent);
        if (pageTask.assignee) normalizer.normalizeReference(pageTask.assignee);
        for (const collection of pageTask.collections) normalizer.normalizeReference(collection);
    }
}

export async function updateAgentWebTaskQueryPage(
    context: AgentWebContext,
    pageLink:
        | {type: "TaskCollection"; id: TaskCollectionId | null}
        | {type: "TaskSubtasks"; task: {id: TaskId | null}},
    oldPageMetadata: AgentWebTaskQueryPageMetadata,
    oldPage: AgentWebTaskQueryPage,
    newPage: AgentWebTaskQueryPage,
): Promise<{
    execute: (
        pageLink:
            | {type: "TaskCollection"; id: TaskCollectionId}
            | {type: "TaskSubtasks"; task: {id: TaskId}},
    ) => Promise<AgentWebTaskQueryPageMetadata>;
}> {
    const contextTime = new Date();
    const contextDate = toCalendarDate(fromDate(contextTime, context.timeZone));

    if (!isDeepEqual(oldPage.pagination, newPage.pagination)) {
        throw new InvalidArgumentError("Can\u2019t update task query pagination", {
            displayMessage: errorDisplayMessage`You can\u2019t update the \u201C${agentWebTaskQueryPageNextPageLinkText}\u201D link in ${{TaskCollection: errorDisplayMessage`task collection`, TaskSubtasks: errorDisplayMessage`subtasks`}[pageLink.type]} markdown. Try again with a more specific update that leaves the \u201C${agentWebTaskQueryPageNextPageLinkText}\u201D link unchanged.`,
        });
    }

    // The end of tasks marker is optional for a page that's actually at the end of
    // tasks (according to metadata). However, for a page that's not at the end of
    // tasks you can't add the end of tasks marker!
    if (oldPageMetadata.beforeCursor !== null && newPage.isEndOfTasks) {
        throw new InvalidArgumentError("Can\u2019t change whether this page is the end of tasks", {
            displayMessage: errorDisplayMessage`Can\u2019t add the \u201CEnd of tasks\u201D marker in an update. Only a \`read\` tool call can tell you whether you\u2019re at the end of a task list or not. Try again without adding the \u201CEnd of tasks\u201D marker.`,
        });
    }

    assert(oldPageMetadata.tasks.length === oldPage.tasks.length);

    const unmatchedOldLinkLessTaskIndexes = new Set<number>();

    const oldPageTasks: Array<Replace<AgentWebTaskQueryPageTask, {taskId: TaskId}>> =
        oldPage.tasks.map((pageTask, taskIndex) => {
            if (pageTask.taskId !== null)
                return pageTask as Replace<AgentWebTaskQueryPageTask, {taskId: TaskId}>;

            unmatchedOldLinkLessTaskIndexes.add(taskIndex);

            return {
                ...pageTask,
                taskId: assertExists(oldPageMetadata.tasks[taskIndex]?.newTaskId),
            };
        });

    const newPageTasks = newPage.tasks.slice();

    // First match unchanged link-less tasks. This keeps their identity if a new task
    // is inserted before them or if the tasks are reordered.
    for (let newTaskIndex = 0; newTaskIndex < newPageTasks.length; newTaskIndex++) {
        const newPageTask = newPageTasks[newTaskIndex]!;
        if (newPageTask.taskId !== null) continue;

        for (const oldTaskIndex of unmatchedOldLinkLessTaskIndexes) {
            if (!isDeepEqual(oldPage.tasks[oldTaskIndex], newPageTask)) continue;

            newPageTasks[newTaskIndex] = {
                ...newPageTask,
                taskId: oldPageTasks[oldTaskIndex]!.taskId,
            };
            unmatchedOldLinkLessTaskIndexes.delete(oldTaskIndex);
            break;
        }
    }

    const unmatchedOldLinkLessTaskIndexesArray = Array.from(unmatchedOldLinkLessTaskIndexes);

    // If a link-less task's fields changed, preserve its identity when it stayed at
    // the same index relative to other link-less tasks.
    if (unmatchedOldLinkLessTaskIndexesArray.length > 0) {
        for (let newTaskIndex = 0; newTaskIndex < newPageTasks.length; newTaskIndex++) {
            const newPageTask = newPageTasks[newTaskIndex]!;
            if (newPageTask.taskId !== null) continue;

            const oldTaskIndex = unmatchedOldLinkLessTaskIndexesArray.shift()!;

            newPageTasks[newTaskIndex] = {
                ...newPageTask,
                taskId: oldPageTasks[oldTaskIndex]!.taskId,
            };

            if (unmatchedOldLinkLessTaskIndexesArray.length === 0) break;
        }
    }

    const oldTaskIds = new Set<TaskId>();
    const newTaskIds = new Set<TaskId>();

    const createdPageTasks: Array<{
        readonly index: number;
        readonly task: AgentWebTaskQueryPageTask;
    }> = [];

    // NOCOMMIT: Integration test where we shuffle task collection tasks and make sure
    // after the API calls the resulting task order is correct with another read.
    //
    // NOCOMMIT: Lots of integration tests for moving tasks then also adding tasks at
    // the same time (nearby). Also moving tasks in one `update` call and then making
    // another `update` call that makes more moves.
    for (const oldTask of oldPageTasks) {
        assert(!oldTaskIds.has(oldTask.taskId));
        oldTaskIds.add(oldTask.taskId);
    }

    for (let taskIndex = 0; taskIndex < newPageTasks.length; taskIndex++) {
        const newTask = newPageTasks[taskIndex]!;

        if (newTask.taskId === null) {
            createdPageTasks.push({index: taskIndex, task: newTask});
            continue;
        }

        if (!newTaskIds.has(newTask.taskId)) {
            newTaskIds.add(newTask.taskId);
            continue;
        }

        const quotedTitle = curlyQuote(newTask.title);

        throw new InvalidArgumentError("Duplicate task in task query page", {
            displayMessage: errorDisplayMessage`The task ${quotedTitle} appears more than once on this ${{TaskCollection: errorDisplayMessage`task collection`, TaskSubtasks: errorDisplayMessage`subtasks`}[pageLink.type]} page. Each task may only appear once. Try again after removing the duplicate task link.`,
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
        if (addedTaskIds.length > 0 || createdPageTasks.length > 0) {
            throw new InvalidArgumentError(
                "Can\u2019t add tasks in an automatically ordered query",
                {
                    displayMessage: errorDisplayMessage`Tasks may only be added to ${{TaskCollection: errorDisplayMessage`task collection`, TaskSubtasks: errorDisplayMessage`subtasks`}[pageLink.type]} markdown when the ${{TaskCollection: errorDisplayMessage`collection is`, TaskSubtasks: errorDisplayMessage`subtasks are`}[pageLink.type]} sorted manually. ${{TaskCollection: errorDisplayMessage`A collection is`, TaskSubtasks: errorDisplayMessage`Subtasks are`}[pageLink.type]} manually sorted when no automatic sorts are applied. That means there are no default sorts/filters and there is no \`?sort\` (or filter) in the path passed to the \`read\` tool. To add tasks to ${{TaskCollection: errorDisplayMessage`an automatically sorted collection`, TaskSubtasks: errorDisplayMessage`automatically sorted subtasks`}[pageLink.type]}, use the \`read\` tool to read an individual task and ${{TaskCollection: errorDisplayMessage`add a collection to the task\u2019s \u201CCollections\u201D field`, TaskSubtasks: errorDisplayMessage`set the parent in the task\u2019s \u201CParent\u201D field`}[pageLink.type]} with the \`update\` tool. Try again without adding new tasks.`,
                },
            );
        }
        if (movedTaskIds.size > 0) {
            throw new InvalidArgumentError(
                "Can\u2019t move tasks in an automatically ordered query",
                {
                    displayMessage: errorDisplayMessage`Tasks may only be reordered in ${{TaskCollection: errorDisplayMessage`task collection`, TaskSubtasks: errorDisplayMessage`subtasks`}[pageLink.type]} markdown when the ${{TaskCollection: errorDisplayMessage`collection is`, TaskSubtasks: errorDisplayMessage`subtasks are`}[pageLink.type]} sorted manually. ${{TaskCollection: errorDisplayMessage`A collection is`, TaskSubtasks: errorDisplayMessage`Subtasks are`}[pageLink.type]} manually sorted when no automatic sorts are applied. That means there are no default sorts/filters and there is no \`?sort\` (or filter) in the path passed to the \`read\` tool. To reorder tasks in ${{TaskCollection: errorDisplayMessage`an automatically sorted collection`, TaskSubtasks: errorDisplayMessage`automatically sorted subtasks`}[pageLink.type]}, look at the ${{TaskCollection: errorDisplayMessage`collection\u2019s`, TaskSubtasks: errorDisplayMessage`task\u2019s subtasks`}[pageLink.type]} sorts and update the corresponding fields in the task (for example, if ${{TaskCollection: errorDisplayMessage`a collection is`, TaskSubtasks: errorDisplayMessage`subtasks are`}[pageLink.type]} sorted by \`?sort=priority\` then updating a task\u2019s priority will move it). If you are updating a task\u2019s fields in ${{TaskCollection: errorDisplayMessage`an automatically sorted collection`, TaskSubtasks: errorDisplayMessage`automatically sorted subtasks`}[pageLink.type]}, you shouldn\u2019t move the task yourself with the \`update\` tool because the task will be moved automatically. Instead read the ${{TaskCollection: errorDisplayMessage`collection`, TaskSubtasks: errorDisplayMessage`subtasks`}[pageLink.type]} again with the \`read\` tool after your update to see the new order. Try again without reordering tasks.`,
                },
            );
        }
    }

    const oldTaskCursorById = new Map(
        oldPageTasks.map((pageTask, index) => [
            pageTask.taskId,
            assertExists(oldPageMetadata.tasks[index]).cursor,
        ]),
    );
    const oldPageTaskById = new Map(oldPageTasks.map(pageTask => [pageTask.taskId, pageTask]));

    type NewPageTaskExecution =
        | {
              type: "Create";
              taskIndex: number;
              task: ApiTaskCreateRequest;
          }
        | {
              type: "Add";
              taskIndex: number;
              taskId: TaskId;
          }
        | {
              type: "Update";
              taskIndex: number;
              taskId: TaskId;
              patches: Array<ApiTaskPatch>;
          };

    const nullableExecutions = await runAllPromises(
        newPageTasks.map(async (newPageTask, taskIndex): Promise<NewPageTaskExecution | null> => {
            /* ========================================================================== *\
             *                              Create new task                               *
            \* ========================================================================== */

            // NOCOMMIT: Test moving a task and creating a task right after (what is the
            // position?). Test moving a task and creating a task right before (what is the
            // position?). The new task should probably get a `MoveInCollection` patch.
            //
            // NOCOMMIT: When creating tasks, we should ideally add links to the newly created
            // tasks in the output.

            if (newPageTask.taskId === null) {
                if (newPageTask.additionalCollectionsCount !== 0) {
                    const quotedTitle = curlyQuote(newPageTask.title);

                    throw new InvalidArgumentError(
                        "Can\u2019t create task with additional collection count",
                        {
                            // NOCOMMIT: Make sure this is tested
                            displayMessage: errorDisplayMessage`Can\u2019t create the task ${quotedTitle} with an \u201Cand ${newPageTask.additionalCollectionsCount} more\u201D collection count since we don\u2019t know which underlying collections you\u2019re trying to add. Try again after removing the count or replacing it with links to the underlying collections.`,
                        },
                    );
                }

                if (
                    newPageTask.subtasks.openTaskCount !== 0 ||
                    newPageTask.subtasks.closedTaskCount !== 0
                ) {
                    const quotedTitle = curlyQuote(newPageTask.title);

                    throw new InvalidArgumentError("Can\u2019t create task with subtask counts", {
                        // NOCOMMIT: Make sure this is tested
                        displayMessage: errorDisplayMessage`Can\u2019t create the task ${quotedTitle} with a \u201CSubtasks\u201D field since we don\u2019t know what the underlying subtasks are. Try again after removing the \u201CSubtasks\u201D field, then call the \`read\` tool on the newly created task and use the \`update\` tool to add subtasks to the newly created task.`,
                    });
                }

                if (
                    newPageTask.status.type === "Open" &&
                    newPageTask.status.isActive &&
                    newPageTask.assignee === null
                ) {
                    const quotedTitle = curlyQuote(newPageTask.title);

                    const assigneeLink: Link = {
                        type: "link",
                        url: context.botAccount.pathname,
                        children: [{type: "text", value: context.botAccount.shortName}],
                    };

                    throw new InvalidArgumentError(
                        "Can\u2019t create active task if there\u2019s no assignee",
                        {
                            displayMessage: errorDisplayMessage`Can\u2019t create the task ${quotedTitle} as active if there\u2019s no assignee. We don\u2019t recommend setting a task as active unless you\u2019re about to work on the task or you know someone else is currently working on the task. Try again and either create the task as open but inactive (e.g. \u201C(Open)\u201D) or set an assignee (e.g. ${quote(`- Assignee: ${printMarkdownTree(assigneeLink).trim()}`)}).`,
                        },
                    );
                }

                const due =
                    newPageTask.dueDateString === null
                        ? undefined
                        : {
                              date: parseAgentWebTaskPageDueDateStringForUpdate(
                                  contextDate,
                                  newPageTask.dueDateString,
                                  () =>
                                      errorDisplayMessage` for task ${curlyQuote(newPageTask.title)}`,
                              ).toString(),
                          };

                return {
                    type: "Create",
                    taskIndex,
                    task: {
                        title: newPageTask.title,
                        status: newPageTask.status,
                        parent: newPageTask.parent
                            ? {task: {id: newPageTask.parent.id}}
                            : undefined,
                        assignee: newPageTask.assignee ? {id: newPageTask.assignee.id} : undefined,
                        collections: newPageTask.collections.map(collection => ({
                            collection: {id: collection.id},
                        })),
                        priority: newPageTask.priority ?? undefined,
                        due,
                    },
                };
            }

            /* ========================================================================== *\
             *                             Add existing task                              *
            \* ========================================================================== */

            const oldPageTask = oldPageTaskById.get(newPageTask.taskId);

            // This task was newly added:
            if (oldPageTask === undefined) {
                const {
                    data: {task},
                } = await context.api.get(context.span, "/tasks/{id}", {
                    params: {path: {id: newPageTask.taskId}},
                });

                const expectedPageTask = intoAgentWebTaskQueryPageTask({
                    timeZone: context.timeZone,
                    contextDate,
                    omittedCollectionId:
                        pageLink.type === "TaskCollection" ? (pageLink.id ?? undefined) : undefined,
                    omittedParentTaskId:
                        pageLink.type === "TaskSubtasks"
                            ? (pageLink.task.id ?? undefined)
                            : undefined,
                    task,
                });

                // Is our actual page task equal to what was expected?
                if (areAgentWebTaskQueryPageTasksEqual(expectedPageTask, newPageTask))
                    return {type: "Add", taskIndex, taskId: newPageTask.taskId};

                const quotedTitle = curlyQuote(newPageTask.title);

                const taskMarkdown = printMarkdownTree({
                    type: "list",
                    ordered: false,
                    spread: false,
                    children: [
                        await printAgentWebTaskQueryPageTaskListItem(
                            context.storage,
                            expectedPageTask,
                        ),
                    ],
                })
                    .trim()
                    .replaceAll("\n", "\\n");

                throw new InvalidArgumentError("Can\u2019t update task fields while adding task", {
                    displayMessage: errorDisplayMessage`You can\u2019t change the task ${quotedTitle}\u2019s title or fields while adding it to ${{TaskCollection: errorDisplayMessage`task collection`, TaskSubtasks: errorDisplayMessage`subtasks`}[pageLink.type]} markdown. Add the task with its current title and fields, then call the \`update\` tool again if you want to change its title or fields. Try again with this exact markdown for the task: ${quote(taskMarkdown)}`,
                });
            }

            /* ========================================================================== *\
             *                                Update task                                 *
            \* ========================================================================== */

            // Don't allow moving a task and updating its fields at the same time. Since the
            // agent needs to completely rewrite the task to move it we believe a common error
            // mode for agents will be to rewrite the task with incorrect fields. Which is why
            // we force a move + update to be done in two separate `update` tool calls.
            if (
                movedTaskIds.has(oldPageTask.taskId) &&
                !areAgentWebTaskQueryPageTasksEqual(oldPageTask, newPageTask)
            ) {
                const quotedTitle = curlyQuote(oldPageTask.title);

                throw new InvalidArgumentError("Can\u2019t move and update task fields together", {
                    displayMessage: errorDisplayMessage`You can\u2019t move the task ${quotedTitle} and change its title or fields in the same \`update\` tool call. Try again with two separate \`update\` tool calls, one to change the task\u2019s title/fields and another to move the task.`,
                });
            }

            if (oldPageTask.additionalCollectionsCount !== newPageTask.additionalCollectionsCount) {
                const quotedTitle = curlyQuote(oldPageTask.title);

                throw new InvalidArgumentError(
                    "Can\u2019t change task collections by updating additional count",
                    {
                        displayMessage: errorDisplayMessage`Can\u2019t change a task\u2019s collections by updating ${curlyQuote(`and ${oldPageTask.additionalCollectionsCount} more`)} to ${curlyQuote(`and ${newPageTask.additionalCollectionsCount} more`)} since we don\u2019t know which underlying collections you\u2019re trying to ${oldPageTask.additionalCollectionsCount < newPageTask.additionalCollectionsCount ? "add" : "remove"}. Instead call the \`read\` tool for the task ${quotedTitle} which will give you the full collection list for the task which you can update with the \`update\` tool.`,
                    },
                );
            }

            if (!isDeepEqual(oldPageTask.subtasks, newPageTask.subtasks)) {
                const quotedTitle = curlyQuote(oldPageTask.title);

                throw new InvalidArgumentError(
                    "Can\u2019t change task subtasks by updating counts",
                    {
                        displayMessage: errorDisplayMessage`Can\u2019t change the task ${quotedTitle}\u2019s subtasks by updating ${curlyQuote(`Subtasks: ${oldPageTask.subtasks.openTaskCount} open, ${oldPageTask.subtasks.closedTaskCount} closed`)} to ${curlyQuote(`Subtasks: ${newPageTask.subtasks.openTaskCount} open, ${newPageTask.subtasks.closedTaskCount} closed`)} since we don\u2019t know which underlying subtasks you\u2019re trying to add, remove, open, or close. Try again with an update that leaves the \`Subtasks\` field unchanged.`,
                    },
                );
            }

            // Force the agent to set an assignee if they're marking a task as active. By
            // default our API sets the bot as active when they make the task active if there's
            // no assignee, we want the agent to make this choice explicitly.
            //
            // NOCOMMIT: Integration test that makes sure the bot can update a task to active
            // when the task is already assigned to another account. Also that the bot can
            // update a task to active and update the assignee at the same time.
            if (
                newPageTask.status.type === "Open" &&
                newPageTask.status.isActive &&
                !newPageTask.assignee
            ) {
                const quotedTitle = curlyQuote(oldPageTask.title);

                const assigneeLink: Link = {
                    type: "link",
                    url: context.botAccount.pathname,
                    children: [{type: "text", value: context.botAccount.shortName}],
                };

                if (oldPageTask.status.type !== "Open" || !oldPageTask.status.isActive) {
                    throw new InvalidArgumentError(
                        "Can\u2019t set task as active if there\u2019s no assignee",
                        {
                            displayMessage: errorDisplayMessage`Can\u2019t set the task ${quotedTitle} as active if there\u2019s no assignee. We don\u2019t recommend setting a task as active unless you\u2019re about to work on the task or you know someone else is currently working on the task. Try again and either set the task as open but inactive (e.g. \`(Open)\`) or set an assignee (e.g. ${quote(`- Assignee: ${printMarkdownTree(assigneeLink).trim()}`)}).`,
                        },
                    );
                } else {
                    throw new InvalidArgumentError(
                        "Can\u2019t remove assignee from an active task",
                        {
                            displayMessage: errorDisplayMessage`Can\u2019t remove the assignee from the active task ${quotedTitle}. An active task implies someone is currently working on the task and so an assignee is required so we know who that is. Try again but set the task as inactive first (e.g. \`(Open)\`).`,
                        },
                    );
                }
            }

            const patches: Array<ApiTaskPatch> = [];

            if (oldPageTask.title !== newPageTask.title) {
                patches.push({type: "SetTitle", title: newPageTask.title});
            }

            if (
                oldPageTask.status.type !== newPageTask.status.type ||
                (oldPageTask.status.type === "Open" &&
                    newPageTask.status.type === "Open" &&
                    oldPageTask.status.isActive !== newPageTask.status.isActive)
            ) {
                patches.push({type: "SetStatus", status: newPageTask.status});
            }

            if (oldPageTask.parent?.id !== newPageTask.parent?.id) {
                patches.push({
                    type: "SetParent",
                    parent: newPageTask.parent ? {task: {id: newPageTask.parent.id}} : null,
                });
            }

            if (oldPageTask.assignee?.id !== newPageTask.assignee?.id) {
                patches.push({type: "SetAssignee", assignee: newPageTask.assignee ?? null});
            }

            if (oldPageTask.dueDateString !== newPageTask.dueDateString) {
                if (newPageTask.dueDateString === null) {
                    patches.push({type: "SetDue", due: null});
                } else {
                    const date = parseAgentWebTaskPageDueDateStringForUpdate(
                        contextDate,
                        newPageTask.dueDateString,
                        () => {
                            const quotedTitle = curlyQuote(oldPageTask.title);

                            return errorDisplayMessage` for task ${quotedTitle}`;
                        },
                    ).toString();

                    patches.push({type: "SetDue", due: {date}});
                }
            }

            if (oldPageTask.priority?.type !== newPageTask.priority?.type) {
                patches.push({type: "SetPriority", priority: newPageTask.priority});
            }

            const oldCollectionIds = new Set(
                oldPageTask.collections.map(collection => collection.id),
            );
            const newCollectionIds = new Set(
                newPageTask.collections.map(collection => collection.id),
            );

            for (const collection of oldPageTask.collections) {
                if (!newCollectionIds.has(collection.id)) {
                    patches.push({type: "RemoveCollection", collectionId: collection.id});
                }
            }

            for (const collection of newPageTask.collections) {
                if (!oldCollectionIds.has(collection.id)) {
                    patches.push({type: "AddCollection", item: {collection}});
                }
            }

            if (patches.length === 0 && !movedTaskIds.has(newPageTask.taskId)) return null;

            return {
                type: "Update",
                taskIndex,
                taskId: newPageTask.taskId,
                patches,
            };
        }),
    );

    const executions = nullableExecutions.filter(isNonNullable);

    const originalPageLink = pageLink;

    return {
        execute: async pageLink => {
            switch (pageLink.type) {
                case "TaskCollection": {
                    // We allow `originalPageLink.id` to be `null` so that a task collection and its
                    // tasks can be created together. Validate the tasks before creating the
                    // collection, then execute the updates with the new collection's ID.
                    assert(
                        originalPageLink.type === "TaskCollection" &&
                            (originalPageLink.id === null || originalPageLink.id === pageLink.id),
                    );
                    break;
                }
                case "TaskSubtasks": {
                    // We allow `originalPageLink.task.id` to be `null` so that you can create a task
                    // and its subtasks at the same time. We'll validate the subtasks before executing
                    // the updates (throwing any errors). While we're validating we don't know the
                    // final `TaskId` which is why it's `null`.
                    assert(
                        originalPageLink.type === "TaskSubtasks" &&
                            (originalPageLink.task.id === null ||
                                originalPageLink.task.id === pageLink.task.id),
                    );
                    break;
                }
                default:
                    throw exhaustive(pageLink);
            }

            const repositionedPageTaskIndexes = new Set<number>();

            for (const execution of executions) {
                if (
                    execution.type === "Create" ||
                    execution.type === "Add" ||
                    movedTaskIds.has(execution.taskId)
                ) {
                    repositionedPageTaskIndexes.add(execution.taskIndex);
                }
            }

            const movementPatchByPageTaskIndex = new Map<number, ApiTaskPatch>();

            // The batch tasks endpoint preserves request order for moves with identical
            // positions. Build movement patches in the page's new order so tasks moved between
            // the same cursors end up in the order the agent wrote.
            for (const taskIndex of repositionedPageTaskIndexes) {
                let afterCursor: ApiTaskQueryCursor | null = null;

                for (let index = taskIndex - 1; index >= 0; index--) {
                    const previousTaskId = newPageTasks[index]!.taskId;
                    if (previousTaskId === null || !stableTaskIds.has(previousTaskId)) continue;

                    const previousTaskCursor = assertExists(oldTaskCursorById.get(previousTaskId));

                    afterCursor = previousTaskCursor;
                    break;
                }

                if (afterCursor === null && oldPageMetadata.afterCursor !== null) {
                    afterCursor = oldPageMetadata.afterCursor;
                }

                let beforeCursor: ApiTaskQueryCursor | null = null;

                for (let index = taskIndex + 1; index < newPageTasks.length; index++) {
                    const nextTaskId = newPageTasks[index]!.taskId;
                    if (nextTaskId === null || !stableTaskIds.has(nextTaskId)) continue;

                    const nextTaskCursor = assertExists(oldTaskCursorById.get(nextTaskId));

                    beforeCursor = nextTaskCursor;
                    break;
                }

                if (beforeCursor === null && oldPageMetadata.beforeCursor !== null) {
                    beforeCursor = oldPageMetadata.beforeCursor;
                }

                let position: ApiTaskMoveInQueryPatchPosition;

                if (afterCursor === null && beforeCursor === null) {
                    position = {type: "End"};
                } else if (afterCursor === null) {
                    position = {type: "Start"};
                } else if (beforeCursor === null) {
                    position = {type: "End"};
                } else {
                    position = {type: "Between", afterCursor, beforeCursor};
                }

                movementPatchByPageTaskIndex.set(
                    taskIndex,
                    pageLink.type === "TaskCollection"
                        ? {type: "MoveInCollection", collectionId: pageLink.id, position}
                        : {type: "MoveInParent", position},
                );
            }

            type TaskBatchExecution = {
                readonly taskIndex: number;
                readonly patch: ApiTaskBatchPatch;
            };

            const removePatches: Array<ApiTaskBatchPatch> = [];
            const patches: Array<TaskBatchExecution> = [];

            for (const removedTaskId of removedTaskIds) {
                removePatches.push({
                    type: "Update",
                    id: removedTaskId,
                    patch:
                        pageLink.type === "TaskCollection"
                            ? {type: "RemoveCollection", collectionId: pageLink.id}
                            : {type: "SetParent", parent: null},
                });
            }

            for (const execution of executions) {
                const movementPatch = movementPatchByPageTaskIndex.get(execution.taskIndex);

                switch (execution.type) {
                    case "Create": {
                        assert(movementPatch !== undefined);

                        const task: ApiTaskCreateRequest =
                            pageLink.type === "TaskCollection"
                                ? {
                                      ...execution.task,
                                      collections: [
                                          ...(execution.task.collections?.filter(
                                              item => item.collection.id !== pageLink.id,
                                          ) ?? []),
                                          {collection: {id: pageLink.id}},
                                      ],
                                  }
                                : {
                                      ...execution.task,
                                      parent: {task: {id: pageLink.task.id}},
                                  };

                        patches.push({
                            taskIndex: execution.taskIndex,
                            patch: {
                                type: "Create",
                                task,
                                patches: [movementPatch],
                            },
                        });
                        break;
                    }
                    case "Add": {
                        patches.push({
                            taskIndex: execution.taskIndex,
                            patch: {
                                type: "Update",
                                id: execution.taskId,
                                patch:
                                    pageLink.type === "TaskCollection"
                                        ? {
                                              type: "AddCollection",
                                              item: {collection: {id: pageLink.id}},
                                          }
                                        : {
                                              type: "SetParent",
                                              parent: {task: {id: pageLink.task.id}},
                                          },
                            },
                        });

                        assert(movementPatch !== undefined);

                        patches.push({
                            taskIndex: execution.taskIndex,
                            patch: {
                                type: "Update",
                                id: execution.taskId,
                                patch: movementPatch,
                            },
                        });
                        break;
                    }
                    case "Update": {
                        for (const patch of execution.patches) {
                            patches.push({
                                taskIndex: execution.taskIndex,
                                patch: {
                                    type: "Update",
                                    id: execution.taskId,
                                    patch,
                                },
                            });
                        }

                        if (movementPatch !== undefined) {
                            patches.push({
                                taskIndex: execution.taskIndex,
                                patch: {
                                    type: "Update",
                                    id: execution.taskId,
                                    patch: movementPatch,
                                },
                            });
                        }
                        break;
                    }
                    default:
                        throw exhaustive(execution);
                }
            }

            const patchResponse =
                removePatches.length === 0 && patches.length === 0
                    ? null
                    : await context.api.patch(context.span, "/tasks", {
                          body: {
                              spaceId: context.spaceId,
                              patches: [
                                  ...removePatches,
                                  ...mapIterable(patches, ({patch}) => patch),
                              ],
                          },
                      });

            const createdTaskIdByPageTaskIndex = new Map<number, TaskId>();
            const movedCursorByPageTaskIndex = new Map<number, ApiTaskQueryCursor>();

            if (patchResponse !== null) {
                assert(patchResponse.data.results.length === removePatches.length + patches.length);

                for (let resultIndex = 0; resultIndex < patches.length; resultIndex++) {
                    const patch = patches[resultIndex]!;
                    const result = patchResponse.data.results[removePatches.length + resultIndex]!;

                    switch (patch.patch.type) {
                        case "Create": {
                            assert(result.type === "Create");
                            assert(result.results.length === (patch.patch.patches?.length ?? 0));

                            const {taskIndex} = patch;
                            createdTaskIdByPageTaskIndex.set(taskIndex, result.task.id);

                            const moveResult = assertExists(result.results[0]);
                            switch (pageLink.type) {
                                case "TaskCollection": {
                                    assert(moveResult.type === "MoveInCollection");
                                    movedCursorByPageTaskIndex.set(taskIndex, moveResult.cursor);
                                    break;
                                }
                                case "TaskSubtasks": {
                                    assert(moveResult.type === "MoveInParent");
                                    movedCursorByPageTaskIndex.set(taskIndex, moveResult.cursor);
                                    break;
                                }
                                default:
                                    throw exhaustive(pageLink);
                            }
                            break;
                        }
                        case "Update": {
                            assert(result.type === "Update");
                            assert(result.result.type === patch.patch.patch.type);

                            const {taskIndex} = patch;

                            switch (pageLink.type) {
                                case "TaskCollection": {
                                    if (result.result.type === "MoveInCollection") {
                                        movedCursorByPageTaskIndex.set(
                                            taskIndex,
                                            result.result.cursor,
                                        );
                                    }
                                    break;
                                }
                                case "TaskSubtasks": {
                                    if (result.result.type === "MoveInParent") {
                                        movedCursorByPageTaskIndex.set(
                                            taskIndex,
                                            result.result.cursor,
                                        );
                                    }
                                    break;
                                }
                                default:
                                    throw exhaustive(pageLink);
                            }
                            break;
                        }
                        default:
                            throw exhaustive(patch.patch);
                    }
                }
            }

            return {
                ...oldPageMetadata,
                tasks: newPageTasks.map((pageTask, taskIndex) => ({
                    cursor: repositionedPageTaskIndexes.has(taskIndex)
                        ? assertExists(movedCursorByPageTaskIndex.get(taskIndex))
                        : assertExists(oldTaskCursorById.get(assertExists(pageTask.taskId))),
                    newTaskId:
                        pageTask.taskId === null
                            ? assertExists(createdTaskIdByPageTaskIndex.get(taskIndex))
                            : null,
                })),
            };
        },
    };
}

function areAgentWebTaskQueryPageTasksEqual(
    task1: AgentWebTaskQueryPageTask,
    task2: AgentWebTaskQueryPageTask,
): boolean {
    return isDeepEqual(
        normalizeAgentWebTaskQueryPageTaskForDeepEqual(task1),
        normalizeAgentWebTaskQueryPageTaskForDeepEqual(task2),
    );
}

// Normalize the task to just the bits we care about comparing for equality. For
// example, it's fine if the parent task titles don't match as long as the parent
// `TaskId`s match.
function normalizeAgentWebTaskQueryPageTaskForDeepEqual(task: AgentWebTaskQueryPageTask) {
    // If you add a new property, TypeScript will error here. Telling you that you need
    // to update this function with the new property.
    assertEqualTypes<
        keyof typeof task,
        | "taskId"
        | "title"
        | "status"
        | "parent"
        | "subtasks"
        | "assignee"
        | "collections"
        | "additionalCollectionsCount"
        | "priority"
        | "dueDateString"
    >();

    return {
        taskId: task.taskId,
        title: task.title,
        status: task.status,
        parent: task.parent?.id,
        subtasks: task.subtasks,
        assignee: task.assignee?.id,
        collections: new Set(task.collections.map(collection => collection.id)),
        additionalCollectionsCount: task.additionalCollectionsCount,
        priority: task.priority?.type,
        dueDateString: task.dueDateString,
    };
}
