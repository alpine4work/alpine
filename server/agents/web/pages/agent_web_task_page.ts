import {produce} from "immer";
import {Link, ListItem, Node, PhrasingContent, Root, Text} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {normalizeAgentWebStaticText} from "~/server/agents/web/internal/normalize_agent_web_static_text.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {printApiMentionReferenceToMentionLinkLabel} from "~/shared/api/content/print_api_content_to_markdown.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {
    ApiAccountReferenceResponse,
    ApiMentionReferenceResponse,
    ApiTaskCollectionReferenceResponse,
    ApiTaskDue,
    ApiTaskPatch,
    ApiTaskPriority,
    ApiTaskStatus,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {interleaveArray} from "~/shared/helpers/array/interleave_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {TaskId} from "~/shared/id/types/id_types.js";

// NOCOMMIT: Parent tasks
//
// NOCOMMIT: Notes
//
// NOCOMMIT: Subtasks
export type AgentWebTaskPage = {
    readonly type: "Task";
    readonly title: string;
    readonly status: ApiTaskStatus;
    readonly assignee: ApiAccountReferenceResponse | null;
    readonly collections: ReadonlyArray<ApiTaskCollectionReferenceResponse>;
    readonly priority: ApiTaskPriority | null;
    readonly due: ApiTaskDue | null;
};

export type AgentWebTaskPageMetadata = {
    readonly type: "Task";
    readonly id: TaskId;
};

export type AgentWebTaskPageWithMetadata = AgentWebTaskPage & {
    readonly metadata: AgentWebTaskPageMetadata;
};

export async function readAgentWebTaskPage(
    context: AgentWebContext,
    id: TaskId,
    {printPage}: {printPage: (page: AgentWebTaskPage) => Promise<string>},
): Promise<{response: string; metadata: AgentWebTaskPageMetadata}> {
    const {
        data: {task},
    } = await context.api.get(context.span, "/tasks/{id}", {params: {path: {id}}});

    const page: AgentWebTaskPageWithMetadata = {
        type: "Task",
        title: task.title,
        status: task.status,
        assignee: task.assignee ? intoApiAccountReference(task.assignee) : null,
        collections:
            task.collections?.map(({collection}) => ({
                type: "TaskCollection",
                id: collection.id,
                title: collection.name,
            })) ?? emptyArray,
        priority: task.priority ?? null,
        due: task.due ?? null,
        metadata: {
            type: "Task",
            id,
        },
    };

    return {
        response: await printPage(page),
        metadata: page.metadata,
    };
}

export function normalizeAgentWebTaskPage<Page extends AgentWebTaskPage>(page: Page): Page {
    return produce(page, page => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            if (page.assignee) normalizer.normalizeReference(page.assignee);
            for (const collection of page.collections) normalizer.normalizeReference(collection);
        });
    });
}

export async function printAgentWebTaskPage(
    storage: AgentWebSessionStorage,
    id: TaskId,
    page: AgentWebTaskPage,
): Promise<Root> {
    const listItemPromises: Array<MaybePromise<ListItem>> = [
        {
            type: "listItem",
            spread: false,
            children: [
                {
                    type: "paragraph",
                    children: [
                        {
                            type: "text",
                            value: `Status: ${page.status.type === "Open" ? (page.status.isActive ? "Open (Active)" : "Open") : "Closed"}`,
                        },
                    ],
                },
            ],
        },
    ];

    if (page.assignee) {
        const {assignee} = page;

        listItemPromises.push(
            (async () => ({
                type: "listItem",
                spread: false,
                children: [
                    {
                        type: "paragraph",
                        children: [
                            {type: "text", value: "Assignee: "},
                            {
                                type: "link",
                                url: await createAgentWebPageStoredLinkPathname(storage, assignee),
                                children: [
                                    {
                                        type: "text",
                                        value: printApiMentionReferenceToMentionLinkLabel(
                                            assignee,
                                            {isAccountShortName: true},
                                        ),
                                    },
                                ],
                            },
                        ],
                    },
                ],
            }))(),
        );
    }

    // NOCOMMIT: Should be able to parse both a bullet list and inline link list. "and"
    // should be optional, commas should be optional, we should be very lenient when
    // parsing this list.
    if (page.collections.length > 0) {
        listItemPromises.push(
            (async () => {
                const collectionLinks = await runAllPromises(
                    page.collections.map(
                        async (collection): Promise<Link> => ({
                            type: "link",
                            url: await createAgentWebPageStoredLinkPathname(storage, collection),
                            children: [
                                {
                                    type: "text",
                                    value: printApiMentionReferenceToMentionLinkLabel(collection),
                                },
                            ],
                        }),
                    ),
                );

                return {
                    type: "listItem",
                    spread: false,
                    children: [
                        {
                            type: "paragraph",
                            children: [
                                {type: "text", value: "Collections: "},
                                ...interleaveArray(
                                    collectionLinks,
                                    cast<Text>({type: "text", value: ", "}),
                                ),
                            ],
                        },
                    ],
                };
            })(),
        );
    }

    if (page.priority) {
        listItemPromises.push({
            type: "listItem",
            spread: false,
            children: [
                {
                    type: "paragraph",
                    children: [{type: "text", value: `Priority: ${page.priority.type}`}],
                },
            ],
        });
    }

    // NOCOMMIT: Nice printing of due date
    if (page.due) {
        listItemPromises.push({
            type: "listItem",
            spread: false,
            children: [
                {
                    type: "paragraph",
                    children: [{type: "text", value: `Due date: ${page.due.date}`}],
                },
            ],
        });
    }

    return {
        type: "root",
        children: [
            {
                type: "heading",
                depth: 1,
                children: [{type: "text", value: page.title}],
            },
            {
                type: "list",
                ordered: false,
                spread: false,
                children: await runAllPromises(listItemPromises),
            },
        ],
    };
}

export async function parseAgentWebTaskPage(
    storage: AgentWebSessionStorage,
    id: TaskId | null,
    root: Root,
): Promise<AgentWebTaskPage> {
    let title: string;

    {
        const firstChild = root.children[0];

        if (firstChild?.type === "heading" && firstChild.depth === 1) {
            root.children.shift();
            title = printMarkdownPhrasingContentText(firstChild.children);
        } else {
            throw new InvalidArgumentError("Missing title in task", {
                displayMessage: errorDisplayMessage`A title is required for tasks. Try again but make sure the task starts with a markdown h1 (e.g. \`# My Task\`).`,
            });
        }
    }

    // NOCOMMIT: Reject additional h1s or h2s in `## Notes` like
    // `agent_web_document_page.ts`

    let page: AgentWebTaskPage = {
        type: "Task",
        title,
        status: {type: "Open", isActive: false},
        assignee: null,
        collections: [],
        priority: null,
        due: null,
    };

    if (root.children.length === 0) return page;

    if (root.children[0]!.type !== "list" || root.children[0].ordered) {
        throw new InvalidArgumentError("Expected task fields", {
            displayMessage: errorDisplayMessage`Unexpected markdown on line ${root.children[0]!.position?.start.line ?? "unknown"}. Try again with either fields (an unordered list with items like \`- Priority: Medium\`) or notes (markdown after the h2 \`## Notes\`) after the task title.`,
        });
    }

    if (root.children.length > 1) {
        throw new InvalidArgumentError("Expected task fields", {
            displayMessage: errorDisplayMessage`Unexpected markdown on line ${root.children[1]!.position?.start.line ?? "unknown"}. Try again with only allowed sections like fields (an unordered list with items like \`- Priority: Medium\`) or notes (markdown after the h2 \`## Notes\`).`,
        });
    }

    const seenFields = new Set<string>();

    for (const item of root.children[0].children) {
        const {label, value, remaining} = parseAgentWebTaskPageField(item);

        let labelKey = normalizeAgentWebStaticText(label);
        if (labelKey === "due-date") labelKey = "due";

        if (seenFields.has(labelKey)) {
            throw new InvalidArgumentError("Duplicate task field", {
                displayMessage: errorDisplayMessage`Duplicate task field \u201C${label}\u201D on line ${item.position?.start.line ?? "unknown"}. Try again with each task field only present once in the field list.`,
            });
        }

        seenFields.add(labelKey);

        // All fields, except collections, should only have a single paragraph and
        // shouldn't have any other markdown in the list item after that.
        //
        // NOCOMMIT: Test this error for all field types!
        if (remaining.length > 0 && label !== "collect") {
            throw new InvalidArgumentError("Unexpected markdown nested in task field", {
                displayMessage: errorDisplayMessage`Unexpected markdown after task field \u201C${label}\u201D on line ${remaining[0]!.position?.start.line ?? item.position?.start.line ?? "unknown"}. Try again with an unordered list item for each task field where the field name is followed by the field value with a colon in between (e.g. \`- Priority: Medium\`).`,
            });
        }

        switch (labelKey) {
            case "statu": {
                page = {...page, status: parseAgentWebTaskPageStatus(item.position, value)};
                break;
            }
            case "assigne": {
                page = {
                    ...page,
                    assignee: await parseAgentWebTaskPageAssignee(storage, item.position, value),
                };
                break;
            }
            case "collect": {
                page = {
                    ...page,
                    collections: await parseAgentWebTaskPageCollections(storage, item, value),
                };
                break;
            }
            case "prioriti": {
                page = {...page, priority: parseAgentWebTaskPagePriority(item.position, value)};
                break;
            }
            case "due": {
                page = {...page, due: parseAgentWebTaskPageDue(item.position, value)};
                break;
            }
            default: {
                throw new InvalidArgumentError("Unknown task field", {
                    displayMessage: errorDisplayMessage`Unknown task field \u201C${label}\u201D on line ${item.position?.start.line ?? "unknown"}. Try again with one of \u201CStatus\u201D, \u201CAssignee\u201D, \u201CCollections\u201D, \u201CPriority\u201D, or \u201CDue date\u201D.`,
                });
            }
        }
    }

    return page;
}

function parseAgentWebTaskPageField(item: ListItem) {
    const firstChild = item.children[0];

    const createError = () => {
        return new InvalidArgumentError("Invalid task fields", {
            displayMessage: errorDisplayMessage`Unexpected markdown on line ${firstChild?.position?.start.line ?? item.position?.start.line ?? "unknown"}. Task fields must be unordered list items with the field name followed by the field value with a colon in between (e.g. \`- Priority: Medium\`).`,
        });
    };

    if (firstChild?.type !== "paragraph") throw createError();

    const firstParagraphChild = firstChild.children[0];
    if (firstParagraphChild?.type !== "text") throw createError();

    const match = firstParagraphChild.value.match(/^([A-Za-z ]*):[ \t]*/);
    if (!match) throw createError();

    const label = match[1]!;

    const rest = firstParagraphChild.value.slice(match[0].length);
    const value: Array<PhrasingContent> = [];

    if (rest.length > 0) value.push({type: "text", value: rest});
    for (const child of firstChild.children.slice(1)) value.push(child);

    return {label, value};
}

function parseAgentWebTaskPageStatus(
    itemPosition: Node["position"],
    value: ReadonlyArray<PhrasingContent>,
): ApiTaskStatus {
    switch (printMarkdownPhrasingContentText(value).trim().toLowerCase()) {
        case "open":
        case "open (inactive)":
            return {type: "Open", isActive: false};
        case "open (active)":
            return {type: "Open", isActive: true};
        case "closed":
            return {type: "Closed"};
        default: {
            const quotedValue = quoteMarkdown(value);

            throw new InvalidArgumentError("Invalid task status", {
                displayMessage: errorDisplayMessage`Unexpected task status ${quotedValue} on line ${value[0]?.position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with \u201COpen\u201D, \u201COpen (Active)\u201D, or \u201CClosed\u201D.`,
            });
        }
    }
}

async function parseAgentWebTaskPageAssignee(
    storage: AgentWebSessionStorage,
    itemPosition: Node["position"],
    value: ReadonlyArray<PhrasingContent>,
): Promise<ApiAccountReferenceResponse | null> {
    const createError = (position: Node["position"]) => {
        const quotedValue = quoteMarkdown(value);

        return new InvalidArgumentError("Invalid task fields", {
            displayMessage: errorDisplayMessage`Unexpected task assignee ${quotedValue} on line ${position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with a link to a human or bot (e.g. \`[John](/human/john-doe)\`).`,
        });
    };

    let link: Link | null = null;

    for (const child of value) {
        if (child.type === "link") {
            link = child;
        }
        if (child.type === "text" && child.value.trim().length === 0) {
            // continue
        } else {
            throw createError(child.position);
        }
    }

    if (link === null) return null;

    const pageLinkResult = await routeAgentWebPageLinkPathname(storage, link.url);

    if (!pageLinkResult || pageLinkResult.pageLink.type !== "Account") {
        throw createError(link.position);
    }

    return pageLinkResult.pageLink;
}
function parseAgentWebTaskPagePriority(
    itemPosition: Node["position"],
    value: ReadonlyArray<PhrasingContent>,
): ApiTaskPriority | null {
    switch (printMarkdownPhrasingContentText(value).trim().toLowerCase()) {
        case "":
            return null;
        case "low":
            return {type: "Low"};
        case "medium":
            return {type: "Medium"};
        case "high":
            return {type: "High"};
        case "urgent":
            return {type: "Urgent"};
        default: {
            const quotedValue = quoteMarkdown(value);

            throw new InvalidArgumentError("Invalid task priority", {
                displayMessage: errorDisplayMessage`Unexpected task priority ${quotedValue} on line ${value[0]?.position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with \u201CLow\u201D, \u201CMedium\u201D, \u201CHigh\u201D, or \u201CUrgent\u201D.`,
            });
        }
    }
}
