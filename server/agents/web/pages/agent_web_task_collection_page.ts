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
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {normalizeAgentWebStaticText} from "~/server/agents/web/internal/normalize_agent_web_static_text.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {
    ApiTaskCollectionColor,
    ApiTaskCollectionPatch,
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
import {TaskCollectionId} from "~/shared/id/types/id_types.js";

export const agentWebTaskCollectionPageApiTasksBatchCount = 30;

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
    readonly tasks: ReadonlyArray<ApiTaskReferenceResponse>;
};

export type AgentWebTaskCollectionPageMetadata = {
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
        limitLength,
        printPage,
    }: {
        limitLength: number;
        printPage: (page: AgentWebTaskCollectionPage) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebTaskCollectionPageMetadata}> {
    // TODO(#agents-web): Task collection page pagination and task filters. Until then
    // URL search params are ignored.
    const initialTasksResult = await context.api.get(context.span, "/task-collections/{id}/tasks", {
        params: {
            path: {id},
            query: {limit: agentWebTaskCollectionPageApiTasksBatchCount},
        },
    });

    const {collection} = initialTasksResult.data;
    const tasks: Array<ApiTaskReferenceResponse> = [];
    let currentTaskBatch = initialTasksResult.data.tasks;
    let nextCursor = initialTasksResult.data.nextCursor;

    while (true) {
        for (const task of currentTaskBatch) {
            tasks.push({type: "Task", id: task.id, title: task.title, status: task.status});
        }

        const page: AgentWebTaskCollectionPageWithMetadata = {
            type: "TaskCollection",
            name: collection.name,
            color: collection.color ?? null,
            tasks: tasks.slice(),
            metadata: {type: "TaskCollection", id},
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
            return {response, metadata: page.metadata};
        }

        const truncatedResult = truncateAgentWebTaskCollectionPage(page, {
            limitLength,
            response,
        });

        if (truncatedResult === null) return {response, metadata: page.metadata};

        return truncatedResult;
    }
}

function truncateAgentWebTaskCollectionPage(
    page: AgentWebTaskCollectionPageWithMetadata,
    {
        limitLength,
        response,
    }: {
        limitLength: number;
        response: string;
    },
): {response: string; metadata: AgentWebTaskCollectionPageMetadata} | null {
    if (page.tasks.length <= 1) return null;

    const limitLengthDifference = response.length - limitLength;
    assert(limitLengthDifference > 0);

    const responseTree = parseMarkdownTree(response);
    const taskList = responseTree.children.find((child): child is List => child.type === "list");

    if (taskList === undefined) return null;
    assert(taskList.children.length === page.tasks.length);

    let lastTaskEndOffset: number | null = null;
    let truncateTaskEndOffset: number | null = null;
    let truncateTaskCount = 0;

    for (const taskListItem of reverseIterable(taskList.children)) {
        const endOffset = assertExists(taskListItem.position?.end.offset);

        lastTaskEndOffset ??= endOffset;
        truncateTaskEndOffset = endOffset;
        truncateTaskCount++;

        if (lastTaskEndOffset - truncateTaskEndOffset >= limitLengthDifference) break;
    }

    // We don't truncate the last task traverse sees.
    truncateTaskCount--;

    // There are no tasks in this page so we don't truncate.
    if (truncateTaskEndOffset === null) return null;

    // Always set when `truncateTaskEndOffset` is set.
    assert(lastTaskEndOffset !== null);

    // No truncation occurred!
    if (truncateTaskEndOffset === lastTaskEndOffset) return null;

    // There should always be at least one task left after we truncate.
    assert(page.tasks.length - truncateTaskCount > 0);

    return {
        response: response.slice(0, truncateTaskEndOffset),
        metadata: page.metadata,
    };
}

export async function createAgentWebTaskCollectionPage(
    context: AgentWebContextWithoutStorage,
    newPage: AgentWebTaskCollectionPage,
): Promise<{
    pageMetadata: AgentWebTaskCollectionPageMetadata;
    pageLink: Extract<AgentWebPageStoredLink, {type: "TaskCollection"}>;
}> {
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
        pageMetadata: {type: "TaskCollection", id: collection.id},
        pageLink: {type: "TaskCollection", id: collection.id, title: collection.name},
    };
}

export async function updateAgentWebTaskCollectionPage(
    context: AgentWebContextWithoutStorage,
    oldPageMetadata: AgentWebTaskCollectionPageMetadata,
    oldPage: AgentWebTaskCollectionPage,
    newPage: AgentWebTaskCollectionPage,
): Promise<AgentWebTaskCollectionPageMetadata> {
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
            for (const task of page.tasks) normalizer.normalizeReference(task);
        });
    });
}

export async function printAgentWebTaskCollectionPage(
    storage: AgentWebSessionStorage,
    id: TaskCollectionId,
    page: AgentWebTaskCollectionPage,
): Promise<Root> {
    const children: Array<RootContent> = [
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

    if (page.tasks.length > 0) {
        children.push({
            type: "list",
            ordered: false,
            spread: true,
            children: await runAllPromises(
                page.tasks.map(task => printAgentWebTaskCollectionPageTaskListItem(storage, task)),
            ),
        });
    }

    return {type: "root", children};
}

async function printAgentWebTaskCollectionPageTaskListItem(
    storage: AgentWebSessionStorage,
    task: ApiTaskReferenceResponse,
): Promise<ListItem> {
    return {
        type: "listItem",
        spread: false,
        children: [
            {
                type: "paragraph",
                children: [
                    {
                        type: "link",
                        url: await createAgentWebPageStoredLinkPathname(storage, task),
                        children: [
                            {
                                type: "text",
                                value: printAgentWebPageStoredLinkLabel(task),
                            },
                        ],
                    },
                ],
            },
        ],
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
    let taskList: List | null = null;

    for (const child of root.children.slice(1)) {
        if (child.type === "paragraph" && !hasColorField && taskList === null) {
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

    const tasks =
        taskList === null
            ? []
            : await runAllPromises(
                  taskList.children.map(taskListItem =>
                      parseAgentWebTaskCollectionPageTask(storage, taskListItem),
                  ),
              );

    return {type: "TaskCollection", name, color, tasks};
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
): Promise<ApiTaskReferenceResponse> {
    const createError = () => {
        return new InvalidArgumentError("Invalid task collection task list item", {
            displayMessage: errorDisplayMessage`Unexpected markdown in the task list item on line ${taskListItem.position?.start.line ?? "unknown"}. Try again with a single task link (e.g. \`- [My Task (Open)](/task/my-task)\`) in each task list item.`,
        });
    };

    const paragraph = taskListItem.children[0];

    if (taskListItem.children.length !== 1 || paragraph?.type !== "paragraph") {
        throw createError();
    }

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

    const pageLinkResult = await routeAgentWebPageLinkPathname(storage, link.url);

    if (!pageLinkResult || pageLinkResult.pageLink.type !== "Task") {
        const quotedValue = quoteMarkdown([link]);

        throw new InvalidArgumentError("Unknown task link in task collection", {
            displayMessage: errorDisplayMessage`Couldn\u2019t find a task for the link ${quotedValue} on line ${link.position?.start.line ?? taskListItem.position?.start.line ?? "unknown"}. Try again with a link to a task you\u2019ve seen before (e.g. \`[My Task (Open)](/task/my-task)\`).`,
        });
    }

    return pageLinkResult.pageLink;
}
