import {fromDate, toCalendarDate} from "@internationalized/date";
import {produce} from "immer";
import {Link, List, ListItem, Node, PhrasingContent, Root, RootContent} from "mdast";
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
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {
    ApiAccountReferenceResponse,
    ApiTaskCollectionColor,
    ApiTaskCollectionPatch,
    ApiTaskPriority,
    ApiTaskReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError, UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {reverseIterable} from "~/shared/helpers/iterable/reverse_iterable.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";

export const agentWebTaskCollectionPageApiTasksBatchCount = 30;
export const agentWebTaskCollectionPageNextPageLinkText = "Next page »";

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

export type AgentWebTaskCollectionPage = {
    readonly type: "TaskCollection";
    readonly name: string;
    readonly color: ApiTaskCollectionColor | null;
    readonly pagination: AgentWebTaskCollectionPagePagination | null;
    readonly tasks: ReadonlyArray<AgentWebTaskCollectionPageTask>;
};

/**
 * Pagination for a task collection page which is printed as a "Next page »" link
 * between the collection fields and the task list. `nextCursorHash` is the short
 * hash for the full `ApiTaskQueryCursor` of the last task on the page (see
 * `createAgentWebTaskQueryCursorHash()`).
 */
export type AgentWebTaskCollectionPagePagination = {
    readonly nextCursorHash: string;
};

/**
 * A task in a task collection page. The task link is printed as a list item with
 * the task fields (a subset of the fields on the task page) nested under it in a
 * sub-list.
 */
export type AgentWebTaskCollectionPageTask = {
    readonly task: ApiTaskReferenceResponse;
    readonly parent: ApiTaskReferenceResponse | null;
    readonly assignee: ApiAccountReferenceResponse | null;
    readonly priority: ApiTaskPriority | null;
    readonly dueDateString: string | null;
};

export type AgentWebTaskCollectionPageMetadata = {
    readonly type: "TaskCollection";
    readonly id: TaskCollectionId;
    readonly tasks: ReadonlyArray<{
        readonly cursor: ApiTaskQueryCursor;
    }>;
};

export type AgentWebTaskCollectionPageWithMetadata = AgentWebTaskCollectionPage & {
    readonly metadata: AgentWebTaskCollectionPageMetadata;
};

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

    const afterCursor = await parseAgentWebTaskCollectionPageSearchParams(
        context.storage,
        id,
        searchParams,
    );

    const initialTasksResult = await context.api.get(context.span, "/task-collections/{id}/tasks", {
        params: {
            path: {id},
            query: {
                limit: agentWebTaskCollectionPageApiTasksBatchCount,
                cursor: afterCursor ?? undefined,
            },
        },
    });

    const {collection} = initialTasksResult.data;
    const tasks: Array<AgentWebTaskCollectionPageTask> = [];
    const taskMetadata: Array<{cursor: ApiTaskQueryCursor}> = [];
    let currentTaskBatch = initialTasksResult.data.tasks;
    let nextCursor = initialTasksResult.data.nextCursor;

    while (true) {
        for (const {cursor, task} of currentTaskBatch) {
            tasks.push({
                task: {type: "Task", id: task.id, title: task.title, status: task.status},
                parent: task.parent
                    ? {
                          type: "Task",
                          id: task.parent.task.id,
                          title: task.parent.task.title,
                          status: task.parent.task.status,
                      }
                    : null,
                assignee: task.assignee ? intoApiAccountReference(task.assignee) : null,
                priority: task.priority ?? null,
                dueDateString: task.due
                    ? formatAgentWebTaskDueDateString(context.timeZone, contextDate, task.due)
                    : null,
            });
            taskMetadata.push({cursor});
        }

        const page: AgentWebTaskCollectionPage = {
            type: "TaskCollection",
            name: collection.name,
            color: collection.color ?? null,
            pagination:
                nextCursor !== null
                    ? {
                          nextCursorHash: await createAgentWebTaskQueryCursorHash(
                              context.storage,
                              id,
                              nextCursor,
                          ),
                      }
                    : null,
            tasks: tasks.slice(),
        };

        const response = await printPage(page);

        if (nextCursor !== null && response.length < limitLength) {
            const nextTasksResult = await context.api.get(
                context.span,
                "/task-collections/{id}/tasks",
                {
                    params: {
                        path: {id},
                        query: {
                            limit: agentWebTaskCollectionPageApiTasksBatchCount,
                            cursor: nextCursor,
                        },
                    },
                },
            );

            currentTaskBatch = nextTasksResult.data.tasks;
            nextCursor = nextTasksResult.data.nextCursor;
            continue;
        }

        if (response.length <= limitLength) {
            return {
                response,
                metadata: {type: "TaskCollection", id, tasks: taskMetadata},
            };
        }

        const truncatedResult = await truncateAgentWebTaskCollectionPage(context.storage, id, {
            page,
            metadata: {type: "TaskCollection", id, tasks: taskMetadata},
            limitLength,
            response,
        });

        if (truncatedResult === null)
            return {
                response,
                metadata: {type: "TaskCollection", id, tasks: taskMetadata},
            };

        return truncatedResult;
    }
}

async function parseAgentWebTaskCollectionPageSearchParams(
    storage: AgentWebSessionStorage,
    id: TaskCollectionId,
    searchParams: URLSearchParams,
): Promise<ApiTaskQueryCursor | null> {
    // TODO(#agents-web): Task filter search params. Until then URL search params other
    // than `after` are ignored.
    const afterCursorHash = searchParams.get("after");

    if (afterCursorHash === null) return null;

    const afterCursor = await getAgentWebTaskQueryCursorForHashIfExists(
        storage,
        id,
        afterCursorHash,
    );

    if (afterCursor === undefined) {
        throw new InvalidArgumentError("Expected `after` search param to be a cursor", {
            displayMessage: errorDisplayMessage`Expected \`?after\` URL search param to be a cursor from a task collection page \u201C${agentWebTaskCollectionPageNextPageLinkText}\u201D link. Try again with a \u201C${agentWebTaskCollectionPageNextPageLinkText}\u201D link you\u2019ve seen before or omit \`?after\`.`,
        });
    }

    return afterCursor;
}

async function truncateAgentWebTaskCollectionPage(
    storage: AgentWebSessionStorage,
    id: TaskCollectionId,
    {
        page,
        metadata,
        limitLength,
        response,
    }: {
        page: AgentWebTaskCollectionPage;
        metadata: AgentWebTaskCollectionPageMetadata;
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
    let collectionPathname: string | null = null;

    // Edge case: if we need to add a pagination link then expect more to be truncated
    // so we can add the pagination link while still fitting into `limitLength`.
    if (page.pagination === null) {
        collectionPathname = await createAgentWebPageStoredLinkPathname(storage, {
            type: "TaskCollection",
            id,
            title: page.name,
        });

        truncateLength +=
            "\n\n[".length +
            agentWebTaskCollectionPageNextPageLinkText.length +
            "](".length +
            collectionPathname.length +
            "?after=".length +
            agentWebTaskQueryCursorHashLength +
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

    let truncatedResponse = response.slice(0, truncateTaskEndOffset);

    // Update the "Next page" link to reflect the new last task cursor after
    // truncation.
    //
    // If there is no "Next page" link and truncation occurred then we need to add a
    // "Next page" link.
    if (page.pagination !== null) {
        let paginationLink: Link | null = null;

        for (const child of responseTree.children) {
            if (child.type !== "paragraph" || child.children.length !== 1) continue;

            const linkChild = child.children[0]!;

            if (
                linkChild.type === "link" &&
                printMarkdownPhrasingContentText(linkChild.children) ===
                    agentWebTaskCollectionPageNextPageLinkText
            ) {
                paginationLink = linkChild;
                break;
            }
        }

        assert(paginationLink !== null);

        const linkStartOffset = assertExists(paginationLink.position?.start.offset);
        const linkEndOffset = assertExists(paginationLink.position?.end.offset);

        assert(linkEndOffset <= truncatedResponse.length);

        truncatedResponse =
            truncatedResponse.slice(0, linkStartOffset) +
            response
                .slice(linkStartOffset, linkEndOffset)
                .replace(/\?after=[^)]+/, `?after=${nextCursorHash}`) +
            truncatedResponse.slice(linkEndOffset);
    } else {
        assert(collectionPathname !== null);

        const linkMarkdown = `[${agentWebTaskCollectionPageNextPageLinkText}](${collectionPathname}?after=${nextCursorHash})`;

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
    }

    return {
        response: truncatedResponse,
        metadata: {
            ...metadata,
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
    if (newPage.pagination !== null) {
        throw new InvalidArgumentError("Can\u2019t create task collection with pagination", {
            displayMessage: errorDisplayMessage`You can\u2019t include a \u201C${agentWebTaskCollectionPageNextPageLinkText}\u201D link when creating a task collection. Try again without a \u201C${agentWebTaskCollectionPageNextPageLinkText}\u201D link.`,
        });
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
        pageMetadata: {type: "TaskCollection", id: collection.id, tasks: []},
        pageLink: {type: "TaskCollection", id: collection.id, title: collection.name},
    };
}

export async function updateAgentWebTaskCollectionPage(
    context: AgentWebContextWithoutStorage,
    oldPageMetadata: AgentWebTaskCollectionPageMetadata,
    oldPage: AgentWebTaskCollectionPage,
    newPage: AgentWebTaskCollectionPage,
): Promise<AgentWebTaskCollectionPageMetadata> {
    if (!isDeepEqual(oldPage.pagination, newPage.pagination)) {
        throw new InvalidArgumentError("Can\u2019t update task collection pagination", {
            displayMessage: errorDisplayMessage`You can\u2019t update the \u201C${agentWebTaskCollectionPageNextPageLinkText}\u201D link in task collection markdown. Try again with a more specific update that leaves the \u201C${agentWebTaskCollectionPageNextPageLinkText}\u201D link unchanged.`,
        });
    }

    if (!isDeepEqual(oldPage.tasks, newPage.tasks)) {
        // TODO(#agents-web): Add, remove, and reorder tasks from a task collection page.
        throw new UnimplementedError(
            "Changing the tasks in a task collection hasn\u2019t been implemented yet",
        );
    }

    const patches: Array<ApiTaskCollectionPatch> = [];

    if (oldPage.name !== newPage.name) {
        patches.push({type: "SetName", name: newPage.name});
    }

    if (oldPage.color !== newPage.color) {
        patches.push({type: "SetColor", color: newPage.color});
    }

    if (patches.length > 0) {
        await context.api.patch(context.span, "/task-collections/{id}", {
            params: {path: {id: oldPageMetadata.id}},
            body: {patches},
        });
    }

    return oldPageMetadata;
}

export function normalizeAgentWebTaskCollectionPage<Page extends AgentWebTaskCollectionPage>(
    page: Page,
): Page {
    return produce(page, page => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            for (const pageTask of page.tasks) {
                normalizer.normalizeReference(pageTask.task);
                if (pageTask.parent) normalizer.normalizeReference(pageTask.parent);
                if (pageTask.assignee) normalizer.normalizeReference(pageTask.assignee);
            }
        });
    });
}

export async function printAgentWebTaskCollectionPage(
    storage: AgentWebSessionStorage,
    id: TaskCollectionId,
    page: AgentWebTaskCollectionPage,
): Promise<Root> {
    const children: Array<MaybePromise<RootContent>> = [
        {
            type: "heading",
            depth: 1,
            children: [{type: "text", value: page.name}],
        },
    ];

    if (page.color !== null) {
        children.push({
            type: "paragraph",
            children: [{type: "text", value: `Color: ${page.color}`}],
        });
    }

    if (page.pagination !== null) {
        const {pagination} = page;

        children.push(
            (async () => {
                const collectionPathname = await createAgentWebPageStoredLinkPathname(storage, {
                    type: "TaskCollection",
                    id,
                    title: page.name,
                });

                return {
                    type: "paragraph",
                    children: [
                        {
                            type: "link",
                            url: `${collectionPathname}?after=${pagination.nextCursorHash}`,
                            children: [
                                {type: "text", value: agentWebTaskCollectionPageNextPageLinkText},
                            ],
                        },
                    ],
                };
            })(),
        );
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

    return {
        type: "root",
        children: await runAllPromises(children),
    };
}

async function printAgentWebTaskCollectionPageTaskListItem(
    storage: AgentWebSessionStorage,
    pageTask: AgentWebTaskCollectionPageTask,
): Promise<ListItem> {
    const [taskPathname, fieldListItems] = await runAllPromises([
        createAgentWebPageStoredLinkPathname(storage, pageTask.task),
        runAllPromises(printAgentWebTaskFieldListItems(storage, pageTask)),
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
                            value: printAgentWebPageStoredLinkLabel(pageTask.task),
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
    const heading = root.children[0];

    if (heading?.type !== "heading" || heading.depth !== 1) {
        throw new InvalidArgumentError("Missing task collection name", {
            displayMessage: errorDisplayMessage`A name is required for task collections. Try again but make sure the task collection markdown starts with a markdown h1 (e.g. \`# My Collection\`) on line 1.`,
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
    let paginationPromise: Promise<AgentWebTaskCollectionPagePagination> | null = null;
    let taskList: List | null = null;

    for (const child of root.children.slice(1)) {
        const paginationLink = getAgentWebTaskCollectionPagePaginationLinkIfPossible(child);

        if (paginationLink !== null && paginationPromise === null && taskList === null) {
            paginationPromise = parseAgentWebTaskCollectionPagePaginationLink(
                storage,
                paginationLink,
            );
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

    const [pagination, tasks] = await runAllPromises([
        paginationPromise,
        taskList === null
            ? []
            : runAllPromises(
                  taskList.children.map(taskListItem =>
                      parseAgentWebTaskCollectionPageTask(storage, taskListItem),
                  ),
              ),
    ]);

    return {type: "TaskCollection", name, color, pagination, tasks};
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

    const pageLinkResult = await routeAgentWebPageLinkPathname(storage, pathname);

    if (
        !pageLinkResult ||
        pageLinkResult.pageLink.type !== "TaskCollection" ||
        nextCursorHash === null
    ) {
        throw new InvalidArgumentError("Invalid task collection page pagination link", {
            displayMessage: errorDisplayMessage`Expected \u201C${agentWebTaskCollectionPageNextPageLinkText}\u201D to link to a task collection page with an \`?after\` cursor. Try again with a valid task collection pagination link.`,
        });
    }

    return {nextCursorHash};
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
                  "assignee",
                  "priority",
                  "dueDateString",
              ])
            : null,
    ]);

    if (!pageLinkResult || pageLinkResult.pageLink.type !== "Task") {
        const quotedValue = quoteMarkdown([link]);

        throw new InvalidArgumentError("Unknown task link in task collection", {
            displayMessage: errorDisplayMessage`Couldn\u2019t find a task for the link ${quotedValue} on line ${link.position?.start.line ?? taskListItem.position?.start.line ?? "unknown"}. Try again with a link to a task you\u2019ve seen before (e.g. \`[My Task (Open)](/task/my-task)\`).`,
        });
    }

    return {
        task: pageLinkResult.pageLink,
        parent: fields?.parent ?? null,
        assignee: fields?.assignee ?? null,
        priority: fields?.priority ?? null,
        dueDateString: fields?.dueDateString ?? null,
    };
}
