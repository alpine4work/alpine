import {produce} from "immer";
import {Code, Link, List, Node, PhrasingContent, Root, RootContent} from "mdast";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {AgentWebPageStoredLink} from "~/server/agents/web/agent_web_page_stored_link.open_source.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {
    ApiTaskQueryFilterResponseWithoutAccountSpace,
    parseAgentWebTaskQueryFilters,
    printAgentWebTaskQueryFilters,
} from "~/server/agents/web/agent_web_task_query_filters.open_source.js";
import {
    parseAgentWebTaskQuerySorts,
    printAgentWebTaskQuerySorts,
} from "~/server/agents/web/agent_web_task_query_sorts.open_source.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.open_source.js";
import {curlyQuote} from "~/server/agents/web/internal/curly_quote.open_source.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.open_source.js";
import {normalizeAgentWebStaticText} from "~/server/agents/web/internal/normalize_agent_web_static_text.open_source.js";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.open_source.js";
import {
    AgentWebTaskQueryPageMetadata,
    AgentWebTaskQueryPagePagination,
    AgentWebTaskQueryPageTask,
    agentWebTaskQueryPageNextPageLinkText,
    intoAgentWebTaskQueryPageTask,
    normalizeAgentWebTaskQueryPage,
    parseAgentWebTaskQueryPageTasks,
    printAgentWebTaskQueryPageSearchParams,
    printAgentWebTaskQueryPageTaskList,
    readAgentWebTaskQueryPage,
    updateAgentWebTaskQueryPage,
} from "~/server/agents/web/pages/agent_web_task_query_page.open_source.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.open_source.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.open_source.js";
import {
    ApiTaskCollectionColor,
    ApiTaskCollectionPatch,
    ApiTaskCollectionResponse,
    ApiTaskQuerySort,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {InvalidArgumentError, UnimplementedError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.open_source.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.open_source.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";

const agentWebTaskCollectionPageNextPageLinkText = agentWebTaskQueryPageNextPageLinkText;

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
    readonly pagination: AgentWebTaskQueryPagePagination | null;
    readonly tasks: ReadonlyArray<AgentWebTaskQueryPageTask>;
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

export type AgentWebTaskCollectionPageMetadata = AgentWebTaskQueryPageMetadata & {
    readonly type: "TaskCollection";
    readonly id: TaskCollectionId;
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
    const result = await readAgentWebTaskQueryPage<
        ApiTaskCollectionResponse,
        AgentWebTaskCollectionPage
    >(context, {
        pageLink: {
            type: "TaskCollection",
            id,
        },
        searchParams,
        limitLength,
        readTaskBatch: async ({cursor, query, limit}) => {
            // The `?manual` search param forces manual collection order instead of collection
            // defaults. It can't be combined with custom filters or sorts.
            if (
                searchParams.has("manual") &&
                (query.filters.length > 0 || query.sorts.length > 0)
            ) {
                throw new InvalidArgumentError(
                    "URL search param has both `?manual` search param and filter/sort search params",
                    {
                        displayMessage: errorDisplayMessage`Can\u2019t use the \`?manual\` URL search param in addition to filter/sort URL search params. Try again and either remove the \`?manual\` search param or remove the filter/sort search params.`,
                    },
                );
            }

            const tasksResult =
                query.filters.length === 0 &&
                query.sorts.length === 0 &&
                !searchParams.has("manual")
                    ? await context.api.get(context.span, "/task-collections/{id}/tasks", {
                          params: {path: {id}, query: {limit, cursor}},
                      })
                    : await context.api.post(context.span, "/task-collections/{id}/tasks-query", {
                          params: {path: {id}},
                          body: {
                              limit,
                              cursor,
                              filters: query.filters,
                              sorts: query.sorts,
                          },
                      });

            return {
                pageLink: {
                    type: "TaskCollection",
                    id,
                    title: tasksResult.data.collection.name,
                },
                resource: tasksResult.data.collection,
                isManuallyOrdered:
                    searchParams.has("manual") ||
                    (query.filters.length === 0 &&
                        query.sorts.length === 0 &&
                        tasksResult.data.collection.defaults.filters.length === 0 &&
                        tasksResult.data.collection.defaults.sorts.length === 0),
                nextCursor: tasksResult.data.nextCursor,
                tasks: tasksResult.data.tasks,
            };
        },
        intoPageTask: ({task, contextDate}) =>
            intoAgentWebTaskQueryPageTask({
                timeZone: context.timeZone,
                contextDate,
                // The collection this page is for is implied by the page itself, so it's filtered
                // out of each task's "Collections" field.
                omittedCollectionId: id,
                task,
            }),
        buildPage: ({queryPage, resource: collection, afterCursor}): AgentWebTaskCollectionPage => {
            const pageBase = {
                type: "TaskCollection" as const,
                name: collection.name,
                ...queryPage,
            };

            return afterCursor === null
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
        },
        printPage,
    });

    return {
        response: result.response,
        metadata: {
            ...result.metadata,
            type: "TaskCollection",
            id,
        },
    };
}
export async function createAgentWebTaskCollectionPage(
    context: AgentWebContext,
    newPage: AgentWebTaskCollectionPage,
    {addAdditionalOutput}: {addAdditionalOutput: (output: string) => void},
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
            displayMessage: errorDisplayMessage`You can\u2019t include a ${curlyQuote(agentWebTaskCollectionPageNextPageLinkText)} link when creating a task collection. Try again without a ${curlyQuote(agentWebTaskCollectionPageNextPageLinkText)} link.`,
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

    const emptyTaskMetadata: AgentWebTaskQueryPageMetadata = {
        afterCursor: null,
        beforeCursor: null,
        isManuallyOrdered: true,
        tasks: [],
    };

    let executeTaskUpdate:
        | ((pageLink: {
              type: "TaskCollection";
              id: TaskCollectionId;
          }) => Promise<AgentWebTaskQueryPageMetadata>)
        | null = null;

    if (newPage.tasks.length > 0) {
        ({execute: executeTaskUpdate} = await updateAgentWebTaskQueryPage(
            context,
            {type: "TaskCollection", id: null},
            emptyTaskMetadata,
            {pagination: null, tasks: [], isEndOfTasks: true},
            {pagination: null, tasks: newPage.tasks, isEndOfTasks: true},
            {addAdditionalOutput},
        ));
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

    const taskMetadata = executeTaskUpdate
        ? await executeTaskUpdate({type: "TaskCollection", id: collection.id})
        : emptyTaskMetadata;

    return {
        pageMetadata: {...taskMetadata, type: "TaskCollection", id: collection.id},
        pageLink: {type: "TaskCollection", id: collection.id, title: collection.name},
    };
}

export async function updateAgentWebTaskCollectionPage(
    context: AgentWebContext,
    oldPageMetadata: AgentWebTaskCollectionPageMetadata,
    oldPage: AgentWebTaskCollectionPage,
    newPage: AgentWebTaskCollectionPage,
    {addAdditionalOutput}: {addAdditionalOutput: (output: string) => void},
): Promise<AgentWebTaskCollectionPageMetadata> {
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

    const {execute: executeQueryUpdate} = await updateAgentWebTaskQueryPage(
        context,
        {type: "TaskCollection", id: oldPageMetadata.id},
        oldPageMetadata,
        oldPage,
        newPage,
        {addAdditionalOutput},
    );

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

    const [, queryMetadata] = await runAllPromises([
        collectionPatches.length > 0
            ? context.api.patch(context.span, "/task-collections/{id}", {
                  params: {path: {id: oldPageMetadata.id}},
                  body: {patches: collectionPatches},
              })
            : null,
        executeQueryUpdate({type: "TaskCollection", id: oldPageMetadata.id}),
    ]);

    return {...queryMetadata, type: "TaskCollection", id: oldPageMetadata.id};
}

export function normalizeAgentWebTaskCollectionPage(
    page: AgentWebTaskCollectionPage,
): AgentWebTaskCollectionPage {
    return produce(page, page => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            normalizeAgentWebTaskQueryPage(normalizer, page);
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

    const taskList = await printAgentWebTaskQueryPageTaskList(
        storage,
        "TaskCollection",
        page.tasks,
    );
    if (taskList !== null) children.push(taskList);

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
        pagination: AgentWebTaskQueryPagePagination;
    },
): Promise<{pathname: string; search: string}> {
    const [pathname, search] = await runAllPromises([
        createAgentWebPageStoredLinkPathname(storage, {
            type: "TaskCollection",
            id,
            title: name,
        }),
        printAgentWebTaskQueryPageSearchParams(storage, pagination),
    ]);

    return {pathname, search};
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
    let paginationPromise: Promise<AgentWebTaskQueryPagePagination> | null = null;
    let taskList: List | null = null;
    let isEndOfTasks = false;

    for (let childIndex = 1; childIndex < root.children.length; childIndex++) {
        const child = root.children[childIndex]!;

        if (isEndOfTasks) {
            throw new InvalidArgumentError("Content after end of task collection tasks", {
                displayMessage: errorDisplayMessage`Nothing may appear after \u201CEnd of tasks\u201D in task collection markdown. Try again after removing the extra content after \u201CEnd of tasks\u201D on line ${child.position?.start.line ?? "unknown"}.`,
            });
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
                    displayMessage: errorDisplayMessage`Expected a code block with filters and sorts after ${curlyQuote(defaultsLabel)} on line ${child.position?.start.line ?? "unknown"}. Try again with and add filters and sorts (e.g. \`status=open&sort=-priority,due\`) in a code block after ${curlyQuote(defaultsLabel)}.`,
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
                    displayMessage: errorDisplayMessage`Unknown task collection field ${curlyQuote(label)} on line ${child.position?.start.line ?? "unknown"}. Try again with the \u201CColor\u201D field (e.g. \`Color: Red\`).`,
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
        parseAgentWebTaskQueryPageTasks(storage, "TaskCollection", taskList),
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
            throw new InvalidArgumentError("Content after end of task collection tasks", {
                displayMessage: errorDisplayMessage`Nothing may appear after \u201CEnd of tasks\u201D in task collection markdown. Try again after removing the extra content after \u201CEnd of tasks\u201D on line ${child.position?.start.line ?? "unknown"}.`,
            });
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
        parseAgentWebTaskQueryPageTasks(storage, "TaskCollection", taskList),
    ]);

    return {type: "TaskCollection", subType: "Tail", name, pagination, tasks, isEndOfTasks};
}

async function parseAgentWebTaskCollectionTailPagePreamble(
    storage: AgentWebSessionStorage,
    paragraph: Extract<RootContent, {type: "paragraph"}>,
): Promise<{
    name: string;
    pagination: AgentWebTaskQueryPagePagination | null;
}> {
    let children = paragraph.children;
    let pagination: AgentWebTaskQueryPagePagination | null = null;

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
): Promise<AgentWebTaskQueryPagePagination> {
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
            displayMessage: errorDisplayMessage`Expected ${curlyQuote(agentWebTaskCollectionPageNextPageLinkText)} to link to a task collection page with an \`?after\` cursor. Try again with a valid task collection pagination link.`,
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
        const quotedValue = curlyQuote(value);

        throw new InvalidArgumentError("Invalid task collection color", {
            displayMessage: errorDisplayMessage`Unexpected task collection color ${quotedValue} on line ${value[0]?.position?.start.line ?? paragraphPosition?.start.line ?? "unknown"}. Try again with \u201CRed\u201D, \u201COrange\u201D, \u201CYellow\u201D, \u201CGreen\u201D, \u201CCyan\u201D, \u201CBlue\u201D, \u201CIndigo\u201D, \u201CPurple\u201D, \u201CPink\u201D, or remove the color entirely.`,
        });
    }

    return color;
}
