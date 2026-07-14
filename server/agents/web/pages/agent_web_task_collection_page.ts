import {CalendarDate, fromDate, toCalendarDate} from "@internationalized/date";
import {produce} from "immer";
import {Code, Link, List, ListItem, Node, PhrasingContent, Root, RootContent} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.js";
import {
    AgentWebPageStoredLink,
    printAgentWebPageStoredLinkLabel,
} from "~/server/agents/web/agent_web_page_stored_link.js";
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
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {normalizeAgentWebStaticText} from "~/server/agents/web/internal/normalize_agent_web_static_text.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {
    formatAgentWebTaskDueDateString,
    parseAgentWebTaskFieldListItems,
    printAgentWebTaskFieldListItems,
} from "~/server/agents/web/pages/agent_web_task_fields.js";
import {parseAgentWebTaskPageDueDateStringForUpdate} from "~/server/agents/web/pages/agent_web_task_page.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {
    ApiAccountReferenceResponse,
    ApiTaskCollectionColor,
    ApiTaskCollectionPatch,
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
import {InvalidArgumentError, UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {partitionArray} from "~/shared/helpers/array/partition_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {reverseIterable} from "~/shared/helpers/iterable/reverse_iterable.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

const agentWebTaskCollectionPageApiTasksBatchCount = 31;
const agentWebTaskCollectionPageNextPageLinkText = "Next page »";

/**
 * The maximum number of collections shown in a task's "Collections" field on a
 * task collection page. Collections past this count are summarized as "and n more"
 * at the end of the field.
 */
const agentWebTaskCollectionPageTaskMaxCollectionCount = 3;

export const apiTaskCollectionColors = getObjectKeysWithKeyofType(
    cast<Record<ApiTaskCollectionColor, true>>({
        Red: true,
        Orange: true,
        Yellow: true,
        Green: true,
        Cyan: true,
        Blue: true,
        Indigo: true,
        Purple: true,
        Pink: true,
    }),
);

/**
 * The first page of a task collection (`subType: "Head"`) starts with the task
 * collection name heading and collection fields like the color and the default
 * filters and sorts. Later pages (`subType: "Tail"`) start with a "Tasks in My
 * Collection." preamble instead so the collection fields are only printed once.
 */
export type AgentWebTaskCollectionPage = {
    readonly type: "TaskCollection";
    readonly name: string;
    readonly pagination: AgentWebTaskCollectionPagePagination | null;
    readonly tasks: ReadonlyArray<AgentWebTaskCollectionPageTask>;
    readonly isEndOfTasks: boolean;
} & (
    | {
          readonly subType: "Head";
          readonly color: ApiTaskCollectionColor | null;
          readonly defaults: AgentWebTaskCollectionPageDefaults | null;
      }
    | {
          readonly subType: "Tail";
      }
);

/**
 * The default filters and sorts a task collection applies to its tasks. These are
 * printed after the collection fields as URL search params in a code block (e.g.
 * `status=open&sort=-priority,due`). A collection without default filters and
 * sorts has `null` defaults.
 */
export type AgentWebTaskCollectionPageDefaults = {
    readonly filters: ReadonlyArray<ApiTaskQueryFilterResponseWithoutAccountSpace>;
    readonly sorts: ReadonlyArray<ApiTaskQuerySort>;
};

/**
 * Pagination for a task collection page which is printed as a "Next page »" link
 * between the collection fields and the task list. `nextCursorHash` is the short
 * hash for the full `ApiTaskQueryCursor` of the last task on the page (see
 * `createAgentWebTaskQueryCursorHash()`). A custom `query` is preserved in the
 * next page link so filtered and sorted task collection reads can paginate.
 */
export type AgentWebTaskCollectionPagePagination = {
    readonly nextCursorHash: string;
    readonly query: AgentWebTaskCollectionPageQuery;
};

/** Custom filters and sorts from a task collection page's URL search params. */
export type AgentWebTaskCollectionPageQuery = {
    readonly filters: ReadonlyArray<ApiTaskQueryFilterResponseWithoutAccountSpace>;
    readonly sorts: ReadonlyArray<ApiTaskQuerySort>;
};

/**
 * A task in a task collection page. The task link is printed as a list item with
 * the task fields (a subset of the fields on the task page) nested under it in a
 * sub-list.
 */
export type AgentWebTaskCollectionPageTask = {
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

export type AgentWebTaskCollectionPageMetadata = {
    readonly type: "TaskCollection";
    readonly id: TaskCollectionId;

    /**
     * The cursor immediately before the first visible task on a later page.
     */
    readonly afterCursor: ApiTaskQueryCursor | null;

    /**
     * The cursor for the first hidden task immediately after this page. `isEndOfTasks`
     * is also the same as `beforeCursor === null`.
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

export type AgentWebTaskCollectionPageWithMetadata = AgentWebTaskCollectionPage & {
    readonly metadata: AgentWebTaskCollectionPageMetadata;
};

function intoAgentWebTaskCollectionPageTask({
    timeZone,
    contextDate,
    collectionId,
    task,
}: {
    timeZone: AgentWebContext["timeZone"];
    contextDate: CalendarDate;
    collectionId: TaskCollectionId;
    task: ApiTaskWithoutNotesResponse;
}): AgentWebTaskCollectionPageTask {
    // The collection this page is for is implied by the page itself, so it's filtered
    // out of each task's "Collections" field.
    const taskCollections = filterMapArray(
        task.collections ?? emptyArray,
        ({collection}): ApiTaskCollectionReferenceResponse | undefined => {
            if (collection.id === collectionId) return;

            return {
                type: "TaskCollection",
                id: collection.id,
                title: collection.name,
            };
        },
    );

    return {
        taskId: task.id,
        title: task.title,
        status: task.status,
        parent: task.parent
            ? {
                  type: "Task",
                  id: task.parent.task.id,
                  title: task.parent.task.title,
                  status: task.parent.task.status,
              }
            : null,
        subtasks: task.subtasks,
        assignee: task.assignee ? intoApiAccountReference(task.assignee) : null,
        collections: taskCollections.slice(0, agentWebTaskCollectionPageTaskMaxCollectionCount),
        additionalCollectionsCount: Math.max(
            taskCollections.length - agentWebTaskCollectionPageTaskMaxCollectionCount,
            0,
        ),
        priority: task.priority ?? null,
        dueDateString: task.due
            ? formatAgentWebTaskDueDateString(timeZone, contextDate, task.due)
            : null,
    };
}

export async function readAgentWebTaskCollectionPage(
    context: AgentWebContext,
    id: TaskCollectionId,
    {
        searchParams,
        limitLength,
        printPage,
    }: {
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebTaskCollectionPage) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebTaskCollectionPageMetadata}> {
    const contextTime = new Date();
    const contextDate = toCalendarDate(fromDate(contextTime, context.timeZone));

    // NOCOMMIT: Add an integration test when a bot tries to use a `cursor` with
    // different `sorts`. Or when an agent tries to use a `cursor` when the default
    // sorts change from underneath them.
    const {afterCursor, query} = await parseAgentWebTaskCollectionPageSearchParams(
        context.storage,
        id,
        searchParams,
    );

    // The `?manual` search param may be added to force the task collection to be
    // sorted manually even when it has default filters and sorts. We need this since
    // no filters/sorts search params means we use the collection defaults instead of
    // manual sorting. So we need a way to explicitly get the tasks in manual sort
    // order.
    //
    // NOCOMMIT: Integration test for `?manual` search param.
    if (searchParams.has("manual") && (query.filters.length > 0 || query.sorts.length > 0)) {
        throw new InvalidArgumentError(
            "URL search param has both `?manual` search param and filter/sort search params",
            {
                displayMessage: errorDisplayMessage`Can\u2019t use the \`?manual\` URL search param in addition to filter/sort URL search params. Try again and either remove the \`?manual\` search param or remove the filter/sort search params.`,
            },
        );
    }

    const tasks: Array<AgentWebTaskCollectionPageTask> = [];
    const taskMetadata: Array<{cursor: ApiTaskQueryCursor}> = [];
    let cursor = afterCursor ?? undefined;

    while (true) {
        const tasksResult =
            query.filters.length === 0 && query.sorts.length === 0 && !searchParams.has("manual")
                ? await context.api.get(context.span, "/task-collections/{id}/tasks", {
                      params: {
                          path: {id},
                          query: {
                              limit: agentWebTaskCollectionPageApiTasksBatchCount,
                              cursor,
                          },
                      },
                  })
                : await context.api.post(context.span, "/task-collections/{id}/tasks-query", {
                      params: {path: {id}},
                      body: {
                          limit: agentWebTaskCollectionPageApiTasksBatchCount,
                          cursor,
                          filters: query.filters,
                          sorts: query.sorts,
                      },
                  });

        const {collection, nextCursor, tasks: currentTaskBatch} = tasksResult.data;

        const lookaheadTask =
            nextCursor === null
                ? null
                : assertExists(currentTaskBatch[currentTaskBatch.length - 1]);
        const visibleTaskBatch =
            lookaheadTask === null ? currentTaskBatch : currentTaskBatch.slice(0, -1);

        function appendTask({cursor: taskCursor, task}: (typeof currentTaskBatch)[number]): void {
            tasks.push(
                intoAgentWebTaskCollectionPageTask({
                    timeZone: context.timeZone,
                    contextDate,
                    collectionId: id,
                    task,
                }),
            );
            taskMetadata.push({cursor: taskCursor});
        }

        for (const task of visibleTaskBatch) appendTask(task);

        const pageNextCursor =
            lookaheadTask === null
                ? null
                : assertExists(assertExists(taskMetadata[taskMetadata.length - 1]).cursor);

        const pageBase = {
            type: "TaskCollection" as const,
            name: collection.name,
            pagination:
                pageNextCursor !== null
                    ? {
                          nextCursorHash: await createAgentWebTaskQueryCursorHash(
                              context.storage,
                              id,
                              pageNextCursor,
                          ),
                          query,
                      }
                    : null,
            tasks: tasks.slice(),
            isEndOfTasks: lookaheadTask === null,
        };

        // Only the first page of a task collection prints the collection fields like the
        // color. Later pages read with an `?after` cursor print a short preamble instead.
        const page: AgentWebTaskCollectionPage =
            afterCursor === null
                ? {
                      ...pageBase,
                      subType: "Head",
                      color: collection.color ?? null,
                      defaults:
                          collection.defaults.filters.length > 0 ||
                          collection.defaults.sorts.length > 0
                              ? collection.defaults
                              : null,
                  }
                : {...pageBase, subType: "Tail"};

        const metadata: AgentWebTaskCollectionPageMetadata = {
            type: "TaskCollection",
            id,
            afterCursor,
            beforeCursor: lookaheadTask?.cursor ?? null,
            isManuallyOrdered:
                searchParams.has("manual") ||
                (query.filters.length === 0 &&
                    query.sorts.length === 0 &&
                    collection.defaults.filters.length === 0 &&
                    collection.defaults.sorts.length === 0),
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

        const truncatedResult = await truncateAgentWebTaskCollectionPage(context.storage, id, {
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

async function parseAgentWebTaskCollectionPageSearchParams(
    storage: AgentWebSessionStorage,
    id: TaskCollectionId,
    searchParams: URLSearchParams,
): Promise<{
    afterCursor: ApiTaskQueryCursor | null;
    query: AgentWebTaskCollectionPageQuery;
}> {
    const afterCursorHash = searchParams.get("after");

    const [afterCursor, filters, sorts] = await runAllPromises([
        (async () => {
            if (afterCursorHash === null) return null;

            const storedAfterCursor = await getAgentWebTaskQueryCursorForHashIfExists(
                storage,
                id,
                afterCursorHash,
            );

            if (storedAfterCursor === undefined) {
                throw new InvalidArgumentError("Expected `after` search param to be a cursor", {
                    displayMessage: errorDisplayMessage`Expected \`?after\` URL search param to be a cursor from a task collection page \u201C${agentWebTaskCollectionPageNextPageLinkText}\u201D link. Try again with a \u201C${agentWebTaskCollectionPageNextPageLinkText}\u201D link you\u2019ve seen before or omit \`?after\`.`,
                });
            }

            return storedAfterCursor;
        })(),
        parseAgentWebTaskQueryFilters(storage, searchParams),
        parseAgentWebTaskQuerySorts(searchParams),
    ]);

    return {
        afterCursor,
        query: {filters, sorts},
    };
}

async function truncateAgentWebTaskCollectionPage(
    storage: AgentWebSessionStorage,
    id: TaskCollectionId,
    {
        page,
        metadata,
        query,
        limitLength,
        response,
    }: {
        page: AgentWebTaskCollectionPage;
        metadata: AgentWebTaskCollectionPageMetadata;
        query: AgentWebTaskCollectionPageQuery;
        limitLength: number;
        response: string;
    },
): Promise<{response: string; metadata: AgentWebTaskCollectionPageMetadata} | null> {
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
        addedPaginationPath = await printAgentWebTaskCollectionPageNextPagePath(storage, id, {
            name: page.name,
            pagination: {
                nextCursorHash: "0".repeat(agentWebTaskQueryCursorHashLength),
                query,
            },
        });

        truncateLength +=
            // We need double newlines when adding after the head page fields and a single
            // space when adding into the tail page preamble. Given double newlines is the
            // longer of the two use that in our character count.
            "\n\n[".length +
            agentWebTaskCollectionPageNextPageLinkText.length +
            "](".length +
            addedPaginationPath.pathname.length +
            "?".length +
            addedPaginationPath.search.length +
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
        id,
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
        // The link is in its own paragraph on head pages and at the end of the preamble
        // paragraph on tail pages. Either way it's a link in a root level paragraph.
        let paginationLink: Link | null = null;

        for (const child of responseTree.children) {
            if (child.type !== "paragraph") continue;

            for (const paragraphChild of child.children) {
                if (
                    paragraphChild.type === "link" &&
                    printMarkdownPhrasingContentText(paragraphChild.children) ===
                        agentWebTaskCollectionPageNextPageLinkText
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
        assert(addedPaginationPath.search.startsWith("after=000000"));

        const path = `${addedPaginationPath.pathname}?after=${nextCursorHash}${addedPaginationPath.search.slice("after=000000".length)}`;

        const linkMarkdown = `[${agentWebTaskCollectionPageNextPageLinkText}](${path})`;

        switch (page.subType) {
            case "Head": {
                // The "Next page" link goes right after the node before the task list (the task
                // collection name heading or the color field).
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
                break;
            }
            case "Tail": {
                // The "Next page" link goes at the end of the "Tasks in My Collection." preamble
                // paragraph.
                const preamble = responseTree.children[0];
                assert(preamble?.type === "paragraph");

                const insertionOffset = assertExists(preamble.position?.end.offset);

                truncatedResponse =
                    truncatedResponse.slice(0, insertionOffset) +
                    " " +
                    linkMarkdown +
                    truncatedResponse.slice(insertionOffset);
                break;
            }
            default:
                throw exhaustive(page);
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

export async function createAgentWebTaskCollectionPage(
    context: AgentWebContextWithoutStorage,
    newPage: AgentWebTaskCollectionPage,
): Promise<{
    pageMetadata: AgentWebTaskCollectionPageMetadata;
    pageLink: Extract<AgentWebPageStoredLink, {type: "TaskCollection"}>;
}> {
    if (newPage.subType !== "Head") {
        throw new InvalidArgumentError("Can only create task collection head pages", {
            displayMessage: errorDisplayMessage`Task collection markdown must start with a name (e.g. \`# My Collection\`) when creating a collection. Try again with a name.`,
        });
    }

    if (newPage.pagination !== null) {
        throw new InvalidArgumentError("Can\u2019t create task collection with pagination", {
            displayMessage: errorDisplayMessage`You can\u2019t include a \u201C${agentWebTaskCollectionPageNextPageLinkText}\u201D link when creating a task collection. Try again without a \u201C${agentWebTaskCollectionPageNextPageLinkText}\u201D link.`,
        });
    }

    if (newPage.defaults !== null) {
        // TODO(#agents-web): Set the default filters and sorts while creating a task
        // collection.
        throw new UnimplementedError(
            "Setting the default filters and sorts while creating a task collection " +
                "hasn\u2019t been implemented yet",
        );
    }

    if (newPage.tasks.length > 0) {
        // TODO(#agents-web): Add tasks to the collection while creating it.
        throw new UnimplementedError(
            "Adding tasks while creating a task collection hasn\u2019t been implemented yet",
        );
    }

    const {
        data: {collection},
    } = await context.api.post(context.span, "/task-collections", {
        body: {
            spaceId: context.spaceId,
            collection: {
                name: newPage.name,
                color: newPage.color ?? undefined,
            },
        },
    });

    return {
        pageMetadata: {
            type: "TaskCollection",
            id: collection.id,
            afterCursor: null,
            beforeCursor: null,
            isManuallyOrdered: true,
            tasks: [],
        },
        pageLink: {type: "TaskCollection", id: collection.id, title: collection.name},
    };
}

export async function updateAgentWebTaskCollectionPage(
    context: AgentWebContext,
    oldPageMetadata: AgentWebTaskCollectionPageMetadata,
    oldPage: AgentWebTaskCollectionPage,
    newPage: AgentWebTaskCollectionPage,
): Promise<AgentWebTaskCollectionPageMetadata> {
    const contextTime = new Date();
    const contextDate = toCalendarDate(fromDate(contextTime, context.timeZone));

    switch (oldPage.subType) {
        case "Head": {
            if (newPage.subType !== "Head") {
                throw new InvalidArgumentError("Can\u2019t update task collection preamble", {
                    displayMessage: errorDisplayMessage`You can\u2019t remove the task collection name markdown h1. Try again with the collection name as a markdown h1 (e.g. \`# My Collection\`) on line 1 of the collection markdown.`,
                });
            }
            break;
        }
        case "Tail": {
            if (newPage.subType !== "Tail" || oldPage.name !== newPage.name) {
                throw new InvalidArgumentError("Can\u2019t update task collection preamble", {
                    displayMessage: errorDisplayMessage`You can only update the task collection name on the first page of the collection. You must leave the \`Tasks in My Collection.\` line at the start of the collection markdown in place. Try calling the \`read\` tool to navigate to the first page of the collection and you can call the \`update\` tool on that page to update the name.`,
                });
            }
            break;
        }
        default:
            throw exhaustive(oldPage);
    }

    if (!isDeepEqual(oldPage.pagination, newPage.pagination)) {
        throw new InvalidArgumentError("Can\u2019t update task collection pagination", {
            displayMessage: errorDisplayMessage`You can\u2019t update the \u201C${agentWebTaskCollectionPageNextPageLinkText}\u201D link in task collection markdown. Try again with a more specific update that leaves the \u201C${agentWebTaskCollectionPageNextPageLinkText}\u201D link unchanged.`,
        });
    }

    // The end of tasks marker is optional for a page that's actually at the end of
    // tasks (according to metadata). However, for a page that's not at the end of
    // tasks you can't add the end of tasks marker!
    if (oldPageMetadata.beforeCursor !== null && newPage.isEndOfTasks) {
        throw new InvalidArgumentError(
            "Can\u2019t change whether this page is the end of tasks or not",
            {
                displayMessage: errorDisplayMessage`Can\u2019t add the \u201CEnd of tasks\u201D marker in an update. Only a \`read\` tool call can tell you whether you\u2019re at the end of a task list or not. Try again without adding the \u201CEnd of tasks\u201D marker.`,
            },
        );
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
        // We expect the old page to be well formed and only list each task once.
        assert(!oldTaskIds.has(oldTask.taskId));
        oldTaskIds.add(oldTask.taskId);
    }

    for (const newTask of newPage.tasks) {
        if (!newTaskIds.has(newTask.taskId)) {
            newTaskIds.add(newTask.taskId);
            continue;
        }

        const quotedTitle = quoteMarkdown([{type: "text", value: newTask.title}]);

        throw new InvalidArgumentError("Duplicate task in new task collection page", {
            displayMessage: errorDisplayMessage`The task ${quotedTitle} appears more than once on this task collection page. Each task may only appear once. Try again after removing the duplicate task link.`,
        });
    }

    const oldTaskIds = Array.from(oldTaskIdSet);
    const newTaskIds = Array.from(newTaskIdSet);

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
                "Can\u2019t add/remove tasks in an automatically ordered collection",
                {
                    displayMessage: errorDisplayMessage`Tasks may only be added to task collection markdown when the collection is sorted manually. A collection is manually sorted when no automatic sorts are applied. That means there are no default sorts/filters and there is no \`?sort\` (or filter) in the path passed to the \`read\` tool. To add tasks to an automatically sorted collection, use the \`read\` tool to read an individual task and add a collection to the task\u2019s \u201CCollections\u201D field with the \`update\` tool. Try again without adding new tasks.`,
                },
            );
        } else if (movedTaskIds.size > 0) {
            throw new InvalidArgumentError(
                "Can\u2019t change tasks in an automatically ordered collection",
                {
                    displayMessage: errorDisplayMessage`Tasks may only be reordered in task collection markdown when the collection is sorted manually. A collection is manually sorted when no automatic sorts are applied. That means there are no default sorts/filters and there is no \`?sort\` (or filter) in the path passed to the \`read\` tool. To reorder tasks in an automatically sorted collection, look at the collection\u2019s sorts and update the corresponding fields in the task (for example, if a collection is sorted by \`?sort=priority\` then updating a task\u2019s priority will move it). If you are updating a task\u2019s fields in an automatically sorted collection, you shouldn\u2019t move the task yourself with the \`update\` tool because the task will be moved automatically. Instead read the collection again with the \`read\` tool after your update to see the new order. Try again without reordering tasks.`,
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

    // Verify that we're adding a task with the correct fields.
    await runAllPromises(
        addedTaskIds.map(async taskId => {
            const {
                data: {task},
            } = await context.api.get(context.span, "/tasks/{id}-without-notes", {
                params: {path: {id: taskId}},
            });

            const expectedPageTask = intoAgentWebTaskCollectionPageTask({
                timeZone: context.timeZone,
                contextDate,
                collectionId: oldPageMetadata.id,
                task,
            });

            const actualPageTask = assertExists(newPageTaskById.get(expectedPageTask.taskId));

            // Is our actual page task equal to what was expected?
            if (areAgentWebTaskCollectionPageTasksEqual(expectedPageTask, actualPageTask)) return;

            const quotedTitle = quoteMarkdown([{type: "text", value: actualPageTask.title}]);

            const taskMarkdown = printMarkdownTree({
                type: "list",
                ordered: false,
                spread: false,
                children: [
                    await printAgentWebTaskCollectionPageTaskListItem(
                        context.storage,
                        expectedPageTask,
                    ),
                ],
            })
                .trim()
                .replaceAll("\n", "\\n");

            throw new InvalidArgumentError("Can\u2019t update task fields while adding task", {
                displayMessage: errorDisplayMessage`You can\u2019t change the task \u201C${quotedTitle}\u201D\u2019s fields while adding it to task collection markdown. Add the task with its current fields, then call the \`update\` tool again if you want to change its fields. Try again with this exact markdown for the task: \`${taskMarkdown}\`.`,
            });
        }),
    );

    for (const newPageTask of newPage.tasks) {
        const oldPageTask = oldPageTaskById.get(newPageTask.taskId);

        // A newly added task only gets the collection membership and position patches
        // below. Its other task fields weren't present on the old collection page, so
        // there is no trustworthy old value to diff them against.
        if (oldPageTask === undefined) continue;

        // Don't allow moving a task and updating its fields at the same time. Since the
        // agent needs to completely rewrite the task to move it we believe a common error
        // mode for agents will be to rewrite the task with incorrect fields. Which is why
        // we force a move + update to be done in two separate `update` tool calls.
        if (
            movedTaskIds.has(oldPageTask.taskId) &&
            !areAgentWebTaskCollectionPageTasksEqual(oldPageTask, newPageTask)
        ) {
            const quotedTitle = quoteMarkdown([{type: "text", value: oldPageTask.title}]);

            throw new InvalidArgumentError(
                "Can\u2019t move and update task fields in the same update",
                {
                    displayMessage: errorDisplayMessage`You can\u2019t move the task ${quotedTitle} and change its fields in the same \`update\` tool call. Try again with two separate \`update\` tool calls, one to change the task\u2019s fields and another to move the task.`,
                },
            );
        }

        if (oldPageTask.additionalCollectionsCount !== newPageTask.additionalCollectionsCount) {
            const quotedTitle = quoteMarkdown([{type: "text", value: oldPageTask.title}]);

            // NOCOMMIT: Make sure this error message is tested
            throw new InvalidArgumentError(
                "Can\u2019t change task collections by updating additional count",
                {
                    displayMessage: errorDisplayMessage`Can\u2019t change a task\u2019s collections by updating \u201Cand ${oldPageTask.additionalCollectionsCount} more\u201D to \u201Cand ${newPageTask.additionalCollectionsCount} more\u201D since we don\u2019t know which underlying collections you\u2019re trying to ${oldPageTask.additionalCollectionsCount < newPageTask.additionalCollectionsCount ? "add" : "remove"}. Instead call the \`read\` tool for the task ${quotedTitle} which will give you the full collection list for the task which you can update with the \`update\` tool.`,
                },
            );
        }

        if (!isDeepEqual(oldPageTask.subtasks, newPageTask.subtasks)) {
            const quotedTitle = quoteMarkdown([{type: "text", value: oldPageTask.title}]);

            throw new InvalidArgumentError("Can\u2019t change task subtasks by updating counts", {
                displayMessage: errorDisplayMessage`Can\u2019t change the task ${quotedTitle}\u2019s subtasks by updating \u201CSubtasks: ${oldPageTask.subtasks.openTaskCount} open, ${oldPageTask.subtasks.closedTaskCount} closed\u201D to \u201CSubtasks: ${newPageTask.subtasks.openTaskCount} open, ${newPageTask.subtasks.closedTaskCount} closed\u201D since we don\u2019t know which underlying subtasks you\u2019re trying to add, remove, open, or close. Try again with an update that leaves the \`Subtasks\` field unchanged.`,
            });
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
            const quotedTitle = quoteMarkdown([{type: "text", value: oldPageTask.title}]);

            const assigneeLink: Link = {
                type: "link",
                url: context.botAccount.pathname,
                children: [{type: "text", value: context.botAccount.shortName}],
            };

            if (oldPageTask.status.type !== "Open" || !oldPageTask.status.isActive) {
                throw new InvalidArgumentError(
                    "Can\u2019t set task as active if there\u2019s no assignee",
                    {
                        displayMessage: errorDisplayMessage`Can\u2019t set the task ${quotedTitle} as active if there\u2019s no assignee. We don\u2019t recommend setting a task as active unless you\u2019re about to work on the task or you know someone else is currently working on the task. Try again and either set the task as open but inactive (e.g. \`(Open)\`) or set an assignee (e.g. \`- Assignee: ${printMarkdownTree(assigneeLink).trim()}\`).`,
                    },
                );
            } else {
                throw new InvalidArgumentError("Can\u2019t remove assignee from an active task", {
                    displayMessage: errorDisplayMessage`Can\u2019t remove the assignee from the active task ${quotedTitle}. An active task implies someone is currently working on the task and so an assignee is required so we know who that is. Try again but set the task as inactive first (e.g. \`(Open)\`).`,
                });
            }
        }

        const taskPatches: Array<ApiTaskPatch> = [];

        if (oldPageTask.title !== newPageTask.title) {
            taskPatches.push({type: "SetTitle", title: newPageTask.title});
        }

        if (
            oldPageTask.status.type !== newPageTask.status.type ||
            (oldPageTask.status.type === "Open" &&
                newPageTask.status.type === "Open" &&
                oldPageTask.status.isActive !== newPageTask.status.isActive)
        ) {
            taskPatches.push({type: "SetStatus", status: newPageTask.status});
        }

        if (oldPageTask.parent?.id !== newPageTask.parent?.id) {
            taskPatches.push({
                type: "SetParent",
                parent: newPageTask.parent ? {task: {id: newPageTask.parent.id}} : null,
            });
        }

        if (oldPageTask.assignee?.id !== newPageTask.assignee?.id) {
            taskPatches.push({type: "SetAssignee", assignee: newPageTask.assignee ?? null});
        }

        if (oldPageTask.dueDateString !== newPageTask.dueDateString) {
            if (newPageTask.dueDateString === null) {
                taskPatches.push({type: "SetDue", due: null});
            } else {
                const date = parseAgentWebTaskPageDueDateStringForUpdate(
                    contextDate,
                    newPageTask.dueDateString,
                    () => {
                        const quotedTitle = quoteMarkdown([
                            {type: "text", value: oldPageTask.title},
                        ]);

                        return errorDisplayMessage` for task ${quotedTitle}`;
                    },
                ).toString();

                taskPatches.push({type: "SetDue", due: {date}});
            }
        }

        if (oldPageTask.priority?.type !== newPageTask.priority?.type) {
            taskPatches.push({type: "SetPriority", priority: newPageTask.priority});
        }

        const oldCollectionIds = new Set(oldPageTask.collections.map(collection => collection.id));
        const newCollectionIds = new Set(newPageTask.collections.map(collection => collection.id));

        for (const collection of oldPageTask.collections) {
            if (!newCollectionIds.has(collection.id)) {
                taskPatches.push({type: "RemoveCollection", collectionId: collection.id});
            }
        }

        for (const collection of newPageTask.collections) {
            if (!oldCollectionIds.has(collection.id)) {
                taskPatches.push({type: "AddCollection", item: {collection}});
            }
        }

        for (const taskPatch of taskPatches)
            taskPatchInputs.push({id: oldPageTask.taskId, patch: taskPatch});
    }

    if (
        oldPage.subType === "Head" &&
        newPage.subType === "Head" &&
        !isDeepEqual(oldPage.defaults, newPage.defaults)
    ) {
        // TODO(#agents-web): Update a task collection's default filters and sorts.
        throw new UnimplementedError(
            "Changing the default filters and sorts of a task collection hasn\u2019t been " +
                "implemented yet",
        );
    }

    for (const removedTaskId of removedTaskIds) {
        taskPatchInputs.push({
            id: removedTaskId,
            patch: {
                type: "RemoveCollection",
                collectionId: oldPageMetadata.id,
            },
        });
    }

    const collectionReference: ApiTaskCollectionReferenceResponse = {
        type: "TaskCollection",
        id: oldPageMetadata.id,
        title: oldPage.name,
    };

    for (const addedTaskId of addedTaskIds) {
        taskPatchInputs.push({
            id: addedTaskId,
            patch: {
                type: "AddCollection",
                item: {collection: collectionReference},
            },
        });
    }

    const repositionedTaskIds = new Set(concatIterables(addedTaskIds, movedTaskIds));

    const newTaskIdsArray = Array.from(newTaskIds);

    // The batch tasks endpoint preserves the request order for moves with identical
    // positions. Add movement patches in the page's new order so a group moved between
    // the same cursors ends up in the same order the agent wrote.
    for (let taskIndex = 0; taskIndex < newTaskIdsArray.length; taskIndex++) {
        const taskId = newTaskIdsArray[taskIndex]!;
        if (!repositionedTaskIds.has(taskId)) continue;

        let afterCursor: ApiTaskQueryCursor | null = null;

        for (let index = taskIndex - 1; index >= 0; index--) {
            const previousTaskId = newTaskIdsArray[index]!;
            if (!stableTaskIds.has(previousTaskId)) continue;

            const previousTaskCursor = oldTaskCursorById.get(previousTaskId);
            if (previousTaskCursor === undefined) continue;

            afterCursor = previousTaskCursor;
            break;
        }

        if (afterCursor === null && oldPage.subType === "Tail") {
            afterCursor = assertExists(oldPageMetadata.afterCursor);
        }

        let beforeCursor: ApiTaskQueryCursor | null = null;

        for (let index = taskIndex + 1; index < newTaskIdsArray.length; index++) {
            const nextTaskId = newTaskIdsArray[index]!;
            if (!stableTaskIds.has(nextTaskId)) continue;

            const nextTaskCursor = oldTaskCursorById.get(nextTaskId);
            if (nextTaskCursor === undefined) continue;

            beforeCursor = nextTaskCursor;
            break;
        }

        if (beforeCursor === null && oldPageMetadata.beforeCursor !== null) {
            beforeCursor = assertExists(oldPageMetadata.beforeCursor);
        }

        let position: ApiTaskMoveInQueryPatchPosition;

        if (afterCursor === null) {
            assert(oldPage.subType === "Head");
            position = {type: "Start"};
        } else if (beforeCursor === null) {
            assert(oldPageMetadata.beforeCursor === null);
            position = {type: "End"};
        } else {
            position = {type: "Between", afterCursor, beforeCursor};
        }

        taskPatchInputs.push({
            id: taskId,
            patch: {
                type: "MoveInCollection",
                collectionId: oldPageMetadata.id,
                position,
            },
        });
    }

    const collectionPatches: Array<ApiTaskCollectionPatch> = [];

    if (oldPage.name !== newPage.name) {
        collectionPatches.push({type: "SetName", name: newPage.name});
    }

    if (
        oldPage.subType === "Head" &&
        newPage.subType === "Head" &&
        oldPage.color !== newPage.color
    ) {
        collectionPatches.push({type: "SetColor", color: newPage.color});
    }

    const [taskPatchResponse] = await runAllPromises([
        taskPatchInputs.length === 0
            ? Promise.resolve(null)
            : context.api.patch(context.span, "/tasks", {
                  body: {spaceId: context.spaceId, patches: taskPatchInputs},
              }),
        collectionPatches.length === 0
            ? Promise.resolve(null)
            : context.api.patch(context.span, "/task-collections/{id}", {
                  params: {path: {id: oldPageMetadata.id}},
                  body: {patches: collectionPatches},
              }),
    ]);

    const movedCursorByTaskId = new Map<TaskId, ApiTaskQueryCursor>();

    if (taskPatchResponse !== null) {
        for (const {task, collections} of taskPatchResponse.data.tasks) {
            if (!repositionedTaskIds.has(task.id)) continue;

            const movedCollection = assertExists(
                collections.find(({collection}) => collection.id === oldPageMetadata.id),
            );
            movedCursorByTaskId.set(task.id, assertExists(movedCollection.movedCursor));
        }
    }

    return {
        ...oldPageMetadata,
        tasks: newTaskIdsArray.map(taskId => ({
            cursor: repositionedTaskIds.has(taskId)
                ? assertExists(movedCursorByTaskId.get(taskId))
                : assertExists(oldTaskCursorById.get(taskId)),
        })),
    };
}

function areAgentWebTaskCollectionPageTasksEqual(
    task1: AgentWebTaskCollectionPageTask,
    task2: AgentWebTaskCollectionPageTask,
) {
    return isDeepEqual(
        normalizeAgentWebTaskCollectionPageTaskForDeepEqual(task1),
        normalizeAgentWebTaskCollectionPageTaskForDeepEqual(task2),
    );
}

// Normalize the task to just the bits we care about comparing for equality. For
// example, it's fine if the parent task titles don't match as long as the parent
// `TaskId`s match.
function normalizeAgentWebTaskCollectionPageTaskForDeepEqual(task: AgentWebTaskCollectionPageTask) {
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

export function normalizeAgentWebTaskCollectionPage<Page extends AgentWebTaskCollectionPage>(
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

export async function printAgentWebTaskCollectionPage(
    storage: AgentWebSessionStorage,
    id: TaskCollectionId,
    page: AgentWebTaskCollectionPage,
): Promise<Root> {
    const children: Array<MaybePromise<RootContent>> = [];

    switch (page.subType) {
        case "Head": {
            children.push({
                type: "heading",
                depth: 1,
                children: [{type: "text", value: page.name}],
            });

            if (page.color !== null) {
                children.push({
                    type: "paragraph",
                    children: [{type: "text", value: `Color: ${page.color}`}],
                });
            }

            if (page.defaults !== null) {
                const {defaults} = page;

                children.push({
                    type: "paragraph",
                    children: [
                        {
                            type: "text",
                            value: `${printAgentWebTaskCollectionPageDefaultsLabel(defaults)}:`,
                        },
                    ],
                });

                children.push(
                    (async () => {
                        const searchParams = [
                            await printAgentWebTaskQueryFilters(storage, defaults.filters),
                            printAgentWebTaskQuerySorts(defaults.sorts),
                        ].filter(searchParams => searchParams.length > 0);

                        return {
                            type: "code",
                            lang: null,
                            value: `${searchParams.join("&")}`,
                        };
                    })(),
                );
            }

            if (page.pagination !== null) {
                const {pagination} = page;

                children.push(
                    (async () => {
                        const {pathname, search} =
                            await printAgentWebTaskCollectionPageNextPagePath(storage, id, {
                                name: page.name,
                                pagination,
                            });

                        return {
                            type: "paragraph",
                            children: [
                                {
                                    type: "link",
                                    url: `${pathname}?${search}`,
                                    children: [
                                        {
                                            type: "text",
                                            value: agentWebTaskCollectionPageNextPageLinkText,
                                        },
                                    ],
                                },
                            ],
                        };
                    })(),
                );
            }
            break;
        }
        case "Tail": {
            children.push(
                (async () => {
                    const children: Array<PhrasingContent> = [
                        {type: "text", value: `Tasks in ${page.name}.`},
                    ];

                    if (page.pagination !== null) {
                        const {pathname, search} =
                            await printAgentWebTaskCollectionPageNextPagePath(storage, id, {
                                name: page.name,
                                pagination: page.pagination,
                            });

                        children.push(
                            {type: "text", value: " "},
                            {
                                type: "link",
                                url: `${pathname}?${search}`,
                                children: [
                                    {
                                        type: "text",
                                        value: agentWebTaskCollectionPageNextPageLinkText,
                                    },
                                ],
                            },
                        );
                    }

                    return {type: "paragraph", children};
                })(),
            );
            break;
        }
        default:
            throw exhaustive(page);
    }

    if (page.tasks.length > 0) {
        children.push(
            (async () => ({
                type: "list",
                ordered: false,
                spread: true,
                children: await runAllPromises(
                    page.tasks.map(pageTask =>
                        printAgentWebTaskCollectionPageTaskListItem(storage, pageTask),
                    ),
                ),
            }))(),
        );
    }

    if (page.isEndOfTasks) {
        children.push({
            type: "paragraph",
            children: [{type: "text", value: "End of tasks."}],
        });
    }

    return {
        type: "root",
        children: await runAllPromises(children),
    };
}

function printAgentWebTaskCollectionPageDefaultsLabel(
    defaults: AgentWebTaskCollectionPageDefaults,
): string {
    // A page with no default filters and no default sorts has `null` defaults.
    assert(defaults.filters.length > 0 || defaults.sorts.length > 0);

    if (defaults.filters.length === 0) return "Default sorts";
    if (defaults.sorts.length === 0) return "Default filters";

    return "Default filters and sorts";
}

async function printAgentWebTaskCollectionPageNextPagePath(
    storage: AgentWebSessionStorage,
    id: TaskCollectionId,
    {
        name,
        pagination,
    }: {
        name: string;
        pagination: AgentWebTaskCollectionPagePagination;
    },
): Promise<{pathname: string; search: string}> {
    const [pathname, search] = await runAllPromises([
        createAgentWebPageStoredLinkPathname(storage, {
            type: "TaskCollection",
            id,
            title: name,
        }),
        printAgentWebTaskQueryFilters(storage, pagination.query.filters).then(filters => {
            return [
                `after=${pagination.nextCursorHash}`,
                filters,
                printAgentWebTaskQuerySorts(pagination.query.sorts),
            ]
                .filter(searchParams => searchParams.length > 0)
                .join("&");
        }),
    ]);

    return {pathname, search};
}

async function printAgentWebTaskCollectionPageTaskListItem(
    storage: AgentWebSessionStorage,
    pageTask: AgentWebTaskCollectionPageTask,
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
                        {
                            type: "text",
                            value: printAgentWebPageStoredLinkLabel(taskReference),
                        },
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

    return {
        type: "listItem",
        spread: false,
        children,
    };
}

export async function parseAgentWebTaskCollectionPage(
    storage: AgentWebSessionStorage,
    id: TaskCollectionId | null,
    root: Root,
): Promise<AgentWebTaskCollectionPage> {
    const firstChild = root.children[0];

    if (id === null || (firstChild?.type === "heading" && firstChild.depth === 1)) {
        return await parseAgentWebTaskCollectionHeadPage(storage, root);
    }

    return await parseAgentWebTaskCollectionTailPage(storage, root);
}

async function parseAgentWebTaskCollectionHeadPage(
    storage: AgentWebSessionStorage,
    root: Root,
): Promise<AgentWebTaskCollectionPage> {
    const heading = root.children[0];

    if (heading?.type !== "heading" || heading.depth !== 1) {
        throw new InvalidArgumentError("Missing task collection name", {
            displayMessage: errorDisplayMessage`Task collection markdown must start with a name (e.g. \`# My Collection\`) when creating a collection. Try again with a name.`,
        });
    }

    const name = printMarkdownPhrasingContentText(heading.children);

    const createUnexpectedError = (node: RootContent) => {
        return new InvalidArgumentError("Unexpected markdown in task collection", {
            displayMessage: errorDisplayMessage`Unexpected markdown on line ${node.position?.start.line ?? "unknown"}. Try again with only a color (e.g. \`Color: Red\`) followed by a task list (an unordered list where every item is a task link) after the task collection name.`,
        });
    };

    let color: ApiTaskCollectionColor | null = null;
    let hasColorField = false;
    let defaultsPromise: Promise<AgentWebTaskCollectionPageDefaults | null> | null = null;
    let paginationPromise: Promise<AgentWebTaskCollectionPagePagination> | null = null;
    let taskList: List | null = null;
    let isEndOfTasks = false;

    for (let childIndex = 1; childIndex < root.children.length; childIndex++) {
        const child = root.children[childIndex]!;

        if (isEndOfTasks) {
            throw createAgentWebTaskCollectionPageContentAfterEndOfTasksError(child);
        }

        if (isAgentWebTaskCollectionPageEndOfTasksParagraph(child)) {
            isEndOfTasks = true;
            continue;
        }

        const paginationLink = getAgentWebTaskCollectionPagePaginationLinkIfPossible(child);

        if (paginationLink !== null && paginationPromise === null && taskList === null) {
            paginationPromise = parseAgentWebTaskCollectionPagePaginationLink(
                storage,
                paginationLink,
            );
            continue;
        }

        const defaultsLabel = getAgentWebTaskCollectionPageDefaultsLabelIfPossible(child);

        if (
            defaultsLabel !== null &&
            defaultsPromise === null &&
            paginationPromise === null &&
            taskList === null
        ) {
            // The default filters and sorts label is followed by a code block holding the
            // filters and sorts as URL search params.
            const codeBlock = root.children[childIndex + 1];

            if (codeBlock?.type !== "code") {
                throw new InvalidArgumentError("Missing task collection defaults code block", {
                    displayMessage: errorDisplayMessage`Expected a code block with filters and sorts after \u201C${defaultsLabel}\u201D on line ${child.position?.start.line ?? "unknown"}. Try again with and add filters and sorts (e.g. \`status=open&sort=-priority,due\`) in a code block after \u201C${defaultsLabel}\u201D.`,
                });
            }

            defaultsPromise = parseAgentWebTaskCollectionPageDefaults(storage, codeBlock);
            childIndex++;
            continue;
        }

        if (
            child.type === "paragraph" &&
            !hasColorField &&
            paginationPromise === null &&
            taskList === null
        ) {
            const firstParagraphChild = child.children[0];
            if (firstParagraphChild?.type !== "text") throw createUnexpectedError(child);

            const match = firstParagraphChild.value.match(/^([A-Za-z ]*):[ \t]*/);
            if (!match) throw createUnexpectedError(child);

            const label = match[1]!;

            if (normalizeAgentWebStaticText(label) !== "color") {
                throw new InvalidArgumentError("Unknown task collection field", {
                    displayMessage: errorDisplayMessage`Unknown task collection field \u201C${label}\u201D on line ${child.position?.start.line ?? "unknown"}. Try again with the \u201CColor\u201D field (e.g. \`Color: Red\`).`,
                });
            }

            const rest = firstParagraphChild.value.slice(match[0].length);
            const value: Array<PhrasingContent> = [];

            if (rest.length > 0) value.push({type: "text", value: rest});
            for (const valueChild of child.children.slice(1)) value.push(valueChild);

            hasColorField = true;
            color = parseAgentWebTaskCollectionPageColor(child.position, value);
            continue;
        }

        if (child.type === "list" && !child.ordered && taskList === null) {
            taskList = child;
            continue;
        }

        throw createUnexpectedError(child);
    }

    const [defaults, pagination, tasks] = await runAllPromises([
        defaultsPromise,
        paginationPromise,
        taskList === null
            ? []
            : runAllPromises(
                  taskList.children.map(taskListItem =>
                      parseAgentWebTaskCollectionPageTask(storage, taskListItem),
                  ),
              ),
    ]);

    return {
        type: "TaskCollection",
        subType: "Head",
        name,
        color,
        defaults,
        pagination,
        tasks,
        isEndOfTasks,
    };
}

async function parseAgentWebTaskCollectionTailPage(
    storage: AgentWebSessionStorage,
    root: Root,
): Promise<AgentWebTaskCollectionPage> {
    const firstChild = root.children[0];

    if (firstChild?.type !== "paragraph") {
        throw new InvalidArgumentError("Invalid task collection preamble", {
            displayMessage: errorDisplayMessage`Task collection markdown must start with the task collection name in a markdown h1 (e.g. \`# My Collection\`) or \u201CTasks in My Collection\u201D. Try again with a proper start to task collection markdown on line 1.`,
        });
    }

    const createUnexpectedError = (node: RootContent) => {
        return new InvalidArgumentError("Unexpected markdown in task collection", {
            displayMessage: errorDisplayMessage`Unexpected markdown on line ${node.position?.start.line ?? "unknown"}. Try again with only a task list (an unordered list where every item is a task link) after the line 1 of the task collection markdown.`,
        });
    };

    let taskList: List | null = null;
    let isEndOfTasks = false;

    for (const child of root.children.slice(1)) {
        if (isEndOfTasks) {
            throw createAgentWebTaskCollectionPageContentAfterEndOfTasksError(child);
        }

        if (isAgentWebTaskCollectionPageEndOfTasksParagraph(child)) {
            isEndOfTasks = true;
            continue;
        }

        if (child.type === "list" && !child.ordered && taskList === null) {
            taskList = child;
            continue;
        }

        throw createUnexpectedError(child);
    }

    const [{name, pagination}, tasks] = await runAllPromises([
        parseAgentWebTaskCollectionTailPagePreamble(storage, firstChild),
        taskList === null
            ? []
            : runAllPromises(
                  taskList.children.map(taskListItem =>
                      parseAgentWebTaskCollectionPageTask(storage, taskListItem),
                  ),
              ),
    ]);

    return {type: "TaskCollection", subType: "Tail", name, pagination, tasks, isEndOfTasks};
}

async function parseAgentWebTaskCollectionTailPagePreamble(
    storage: AgentWebSessionStorage,
    paragraph: Extract<RootContent, {type: "paragraph"}>,
): Promise<{
    name: string;
    pagination: AgentWebTaskCollectionPagePagination | null;
}> {
    let children = paragraph.children;
    let pagination: AgentWebTaskCollectionPagePagination | null = null;

    const lastChild = children[children.length - 1];
    if (
        lastChild?.type === "link" &&
        printMarkdownPhrasingContentText(lastChild.children) ===
            agentWebTaskCollectionPageNextPageLinkText
    ) {
        pagination = await parseAgentWebTaskCollectionPagePaginationLink(storage, lastChild);
        children = children.slice(0, -1);

        const lastText = children[children.length - 1];
        if (lastText?.type === "text" && lastText.value.endsWith(" ")) {
            children = [
                ...children.slice(0, -1),
                {...lastText, value: lastText.value.slice(0, -1)},
            ];
        }
    }

    const text = printMarkdownPhrasingContentText(children);
    const match = text.match(/^Tasks in ([\s\S]*?)(?:\.)?$/);

    if (!match) {
        throw new InvalidArgumentError("Invalid task collection preamble", {
            displayMessage: errorDisplayMessage`Task collection markdown must start with \u201CTasks in My Collection\u201D (where \u201CMy Collection\u201D is the actual name of the task collection) when reading a later task collection page. Try again with a proper task collection preamble on line 1.`,
        });
    }

    return {name: match[1]!, pagination};
}

function isAgentWebTaskCollectionPageEndOfTasksParagraph(node: RootContent): boolean {
    return (
        node.type === "paragraph" &&
        /^End of tasks\.?$/.test(printMarkdownPhrasingContentText(node.children))
    );
}

function createAgentWebTaskCollectionPageContentAfterEndOfTasksError(node: RootContent) {
    return new InvalidArgumentError("Content after end of task collection tasks", {
        displayMessage: errorDisplayMessage`Nothing may appear after \u201CEnd of tasks\u201D in task collection markdown. Try again after removing the extra content after \u201CEnd of tasks\u201D on line ${node.position?.start.line ?? "unknown"}.`,
    });
}

/**
 * Returns the label text of a default filters and sorts label paragraph (e.g.
 * "Default filters and sorts:") or `null` if the node is some other markdown. The
 * trailing colon is optional and the label is matched leniently with
 * `normalizeAgentWebStaticText()`.
 */
function getAgentWebTaskCollectionPageDefaultsLabelIfPossible(node: RootContent): string | null {
    if (node.type !== "paragraph") return null;

    const match = printMarkdownPhrasingContentText(node.children).match(/^([A-Za-z ]+):?$/);

    if (!match) return null;

    const label = match[1]!;

    switch (normalizeAgentWebStaticText(label)) {
        case "default":
        case "default-filter":
        case "default-sort":
        case "default-filter-and-sort":
        case "default-sort-and-filter":
            return label;
        default:
            return null;
    }
}

/**
 * Parses the URL search params in a default filters and sorts code block into the
 * page's API task filters and sorts. Returns `null` for an empty code block (a
 * collection without default filters and sorts).
 */
async function parseAgentWebTaskCollectionPageDefaults(
    storage: AgentWebSessionStorage,
    codeBlock: Code,
): Promise<AgentWebTaskCollectionPageDefaults | null> {
    const content = codeBlock.value.trim();

    if (content.includes("\n")) {
        throw new InvalidArgumentError("Multiple lines in task collection defaults", {
            displayMessage: errorDisplayMessage`Expected a single line of URL search params in the default filters and sorts code block on line ${codeBlock.position?.start.line ?? "unknown"}. Try again with all the default filters and sorts on one line (e.g. \`status=open&sort=-priority,due\`).`,
        });
    }

    const searchParamsString = content.startsWith("?") ? content.slice(1) : content;

    const searchParams = new URLSearchParams(searchParamsString);
    const [filters, sorts] = await runAllPromises([
        parseAgentWebTaskQueryFilters(storage, searchParams),
        parseAgentWebTaskQuerySorts(searchParams),
    ]);

    if (filters.length === 0 && sorts.length === 0) return null;

    return {filters, sorts};
}

function getAgentWebTaskCollectionPagePaginationLinkIfPossible(node: RootContent): Link | null {
    if (node.type !== "paragraph" || node.children.length !== 1) return null;

    const child = node.children[0]!;

    if (
        child.type !== "link" ||
        printMarkdownPhrasingContentText(child.children) !==
            agentWebTaskCollectionPageNextPageLinkText
    ) {
        return null;
    }

    return child;
}

async function parseAgentWebTaskCollectionPagePaginationLink(
    storage: AgentWebSessionStorage,
    link: Link,
): Promise<AgentWebTaskCollectionPagePagination> {
    const {pathname, searchParams} = normalizeAgentWebPath(link.url);
    const nextCursorHash = searchParams.get("after");

    const [pageLinkResult, filters, sorts] = await runAllPromises([
        routeAgentWebPageLinkPathname(storage, pathname),
        parseAgentWebTaskQueryFilters(storage, searchParams),
        parseAgentWebTaskQuerySorts(searchParams),
    ]);

    if (
        !pageLinkResult ||
        pageLinkResult.pageLink.type !== "TaskCollection" ||
        nextCursorHash === null
    ) {
        throw new InvalidArgumentError("Invalid task collection page pagination link", {
            displayMessage: errorDisplayMessage`Expected \u201C${agentWebTaskCollectionPageNextPageLinkText}\u201D to link to a task collection page with an \`?after\` cursor. Try again with a valid task collection pagination link.`,
        });
    }

    return {
        nextCursorHash,
        query: {filters, sorts},
    };
}

function parseAgentWebTaskCollectionPageColor(
    paragraphPosition: Node["position"],
    value: ReadonlyArray<PhrasingContent>,
): ApiTaskCollectionColor | null {
    const text = printMarkdownPhrasingContentText(value).trim().toLowerCase();

    if (text.length === 0 || text === "none") return null;

    const color = apiTaskCollectionColors.find(color => color.toLowerCase() === text);

    if (color === undefined) {
        const quotedValue = quoteMarkdown(value);

        throw new InvalidArgumentError("Invalid task collection color", {
            displayMessage: errorDisplayMessage`Unexpected task collection color ${quotedValue} on line ${value[0]?.position?.start.line ?? paragraphPosition?.start.line ?? "unknown"}. Try again with \u201CRed\u201D, \u201COrange\u201D, \u201CYellow\u201D, \u201CGreen\u201D, \u201CCyan\u201D, \u201CBlue\u201D, \u201CIndigo\u201D, \u201CPurple\u201D, \u201CPink\u201D, or remove the color entirely.`,
        });
    }

    return color;
}

async function parseAgentWebTaskCollectionPageTask(
    storage: AgentWebSessionStorage,
    taskListItem: ListItem,
): Promise<AgentWebTaskCollectionPageTask> {
    const createError = () => {
        return new InvalidArgumentError("Invalid task collection task list item", {
            displayMessage: errorDisplayMessage`Unexpected markdown in the task list item on line ${taskListItem.position?.start.line ?? "unknown"}. Try again with a single task link (e.g. \`- [My Task (Open)](/task/my-task)\`) in each task list item, optionally followed by a nested list of task fields (e.g. \`- Priority: Medium\`).`,
        });
    };

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

    const [pageLinkResult, fields] = await runAllPromises([
        routeAgentWebPageLinkPathname(storage, link.url),
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

    if (!pageLinkResult || pageLinkResult.pageLink.type !== "Task") {
        const quotedValue = quoteMarkdown([link]);

        throw new InvalidArgumentError("Unknown task link in task collection", {
            displayMessage: errorDisplayMessage`Couldn\u2019t find a task for the link ${quotedValue} on line ${link.position?.start.line ?? taskListItem.position?.start.line ?? "unknown"}. You may only add a task you\u2019ve previously seen to a collection. Try calling the \`create\` tool to create a new task and then add that new task to the collection, or try calling the \`search\` tool to find an existing task you want to add to the collection.`,
        });
    }

    const label = printMarkdownPhrasingContentText(link.children);
    const statusMatch = label.match(/^([\s\S]*) \((open|open, active|open, inactive|closed)\)$/i);

    if (statusMatch === null) {
        throw new InvalidArgumentError("Missing status in task collection task link label", {
            displayMessage: errorDisplayMessage`Missing status at the end of task link label on line ${link.position?.start.line ?? taskListItem.position?.start.line ?? "unknown"}. Task link labels must end with \u201C (Open)\u201D, \u201C (Open, active)\u201D, or \u201C (Closed)\u201D. Try again with a task link like \`[My Task (Open)](/task/my-task)\`.`,
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
        parent: fields?.parent ?? null,
        subtasks: fields?.subtasks ?? {openTaskCount: 0, closedTaskCount: 0},
        assignee: fields?.assignee ?? null,
        collections: fields?.collections ?? [],
        additionalCollectionsCount: fields?.additionalCollectionsCount ?? 0,
        priority: fields?.priority ?? null,
        dueDateString: fields?.dueDateString ?? null,
    };
}
