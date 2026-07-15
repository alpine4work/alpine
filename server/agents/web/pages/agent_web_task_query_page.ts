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
