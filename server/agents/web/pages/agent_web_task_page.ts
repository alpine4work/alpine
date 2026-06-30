import {CalendarDate, fromDate, parseDate, toCalendarDate} from "@internationalized/date";
import {produce} from "immer";
import {Link, List, ListItem, Node, Parent, PhrasingContent, Root, RootContent, Text} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {normalizeAgentWebStaticText} from "~/server/agents/web/internal/normalize_agent_web_static_text.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {normalizeApiContent} from "~/shared/api/content/normalize_api_content.js";
import {
    printApiMentionReferenceToMentionLinkLabel,
    printMarkdownTree,
} from "~/shared/api/content/print_api_content_to_markdown.js";
import {unzipKeysFromApiContentResponse} from "~/shared/api/content/zip_or_unzip_keys_from_api_content_response.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    ApiAccountReferenceResponse,
    ApiMentionReferenceResponse,
    ApiTaskCollectionReferenceResponse,
    ApiTaskDue,
    ApiTaskPatch,
    ApiTaskPriority,
    ApiTaskReferenceResponse,
    ApiTaskStatus,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {interleaveArray} from "~/shared/helpers/array/interleave_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {parseCalendarDates} from "~/shared/helpers/date/parse_calendar_dates.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {TaskId} from "~/shared/id/types/id_types.js";

// NOCOMMIT: Subtasks
export type AgentWebTaskPage = {
    readonly type: "Task";
    readonly title: string;
    readonly status: ApiTaskStatus;
    readonly parent: ApiTaskReferenceResponse | null;
    readonly assignee: ApiAccountReferenceResponse | null;
    readonly collections: ReadonlyArray<ApiTaskCollectionReferenceResponse>;
    readonly priority: ApiTaskPriority | null;
    readonly dueDateString: string | null;
    readonly notes: ApiContentResponseWithoutKeys;
};

export type AgentWebTaskPageMetadata = {
    readonly type: "Task";
    readonly id: TaskId;
    readonly notes: {
        readonly version: number;
        readonly keys: ReadonlyArray<ApiContentKey>;
    };
};

export type AgentWebTaskPageWithMetadata = AgentWebTaskPage & {
    readonly metadata: AgentWebTaskPageMetadata;
};

export async function readAgentWebTaskPage(
    context: AgentWebContext,
    id: TaskId,
    {printPage}: {printPage: (page: AgentWebTaskPage) => Promise<string>},
): Promise<{response: string; metadata: AgentWebTaskPageMetadata}> {
    const contextTime = new Date();
    const contextDate = toCalendarDate(fromDate(contextTime, context.timeZone));

    const {
        data: {task},
    } = await context.api.get(context.span, "/tasks/{id}", {params: {path: {id}}});

    const taskDueDate = task.due ? parseDate(task.due.date) : null;
    const {content: notes, keys: notesKeys} = unzipKeysFromApiContentResponse(task.notes.content);

    const page: AgentWebTaskPageWithMetadata = {
        type: "Task",
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
        assignee: task.assignee ? intoApiAccountReference(task.assignee) : null,
        collections:
            task.collections?.map(({collection}) => ({
                type: "TaskCollection",
                id: collection.id,
                title: collection.name,
            })) ?? emptyArray,
        priority: task.priority ?? null,
        dueDateString: taskDueDate
            ? formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                  defaultLocale,
                  context.timeZone,
                  contextDate,
                  taskDueDate.toDate(context.timeZone),
                  {withoutTime: true, withLongMonth: true},
              )
            : null,
        notes,
        metadata: {
            type: "Task",
            id,
            notes: {
                version: task.notes.version,
                keys: notesKeys,
            },
        },
    };

    return {
        response: await printPage(page),
        metadata: page.metadata,
    };
}

export async function createAgentWebTaskPage(
    context: AgentWebContextWithoutStorage,
    newPage: AgentWebTaskPage,
): Promise<{
    pageMetadata: AgentWebTaskPageMetadata;
    pageLink: Extract<ApiMentionReferenceResponse, {readonly type: "Task"}>;
}> {
    const contextTime = new Date();
    const contextDate = toCalendarDate(fromDate(contextTime, context.timeZone));

    let due: ApiTaskDue | null = null;

    // Force the agent to set an assignee if they're marking a task as active. By
    // default our API sets the bot as active when they make the task active if there's
    // no assignee, we want the agent to make this choice explicitly.
    //
    // NOCOMMIT: Integration test that makes sure the bot can create an active task
    // assigned to another account.
    if (newPage.status.type === "Open" && newPage.status.isActive && !newPage.assignee) {
        const assigneeLink: Link = {
            type: "link",
            url: context.botAccount.pathname,
            children: [{type: "text", value: context.botAccount.shortName}],
        };

        throw new InvalidArgumentError(
            "Can\u2019t set task as active if there\u2019s no assignee",
            {
                displayMessage: errorDisplayMessage`Can\u2019t set task as active if there\u2019s no assignee. We don\u2019t recommend setting a task as active unless you\u2019re about to work on the task or you know someone else is currently working on the task. Try again and either set the task as open but inactive (e.g. \`- Status: Open\`) or set an assignee (e.g. \`- Assignee: ${printMarkdownTree(assigneeLink).trim()}\`).`,
            },
        );
    }

    if (newPage.dueDateString !== null) {
        const date = parseAgentWebTaskPageDueDateStringForUpdate(
            contextDate,
            newPage.dueDateString,
        ).toString();

        due = {date};
    }

    const {
        data: {task},
    } = await context.api.post(context.span, "/tasks", {
        body: {
            spaceId: context.spaceId,
            task: {
                title: newPage.title,
                status: newPage.status,
                parent: newPage.parent ? {task: {id: newPage.parent.id}} : undefined,
                assignee: newPage.assignee ? {id: newPage.assignee.id} : undefined,
                collections: newPage.collections.map(collection => ({
                    collection: {id: collection.id},
                })),
                priority: newPage.priority ?? undefined,
                due: due ?? undefined,
                content: isAgentWebTaskPageNotesEmpty(newPage.notes) ? undefined : newPage.notes,
            },
        },
    });

    const {keys: notesKeys} = unzipKeysFromApiContentResponse(task.notes.content);

    return {
        pageMetadata: {
            type: "Task",
            id: task.id,
            notes: {
                version: task.notes.version,
                keys: notesKeys,
            },
        },
        pageLink: {
            type: "Task",
            id: task.id,
            title: task.title.length > 0 ? task.title : "Untitled",
            status: task.status,
        },
    };
}

export async function updateAgentWebTaskPage(
    context: AgentWebContextWithoutStorage,
    oldPageMetadata: AgentWebTaskPageMetadata,
    oldPage: AgentWebTaskPage,
    newPage: AgentWebTaskPage,
): Promise<AgentWebTaskPageMetadata> {
    const contextTime = new Date();
    const contextDate = toCalendarDate(fromDate(contextTime, context.timeZone));

    // Force the agent to set an assignee if they're marking a task as active. By
    // default our API sets the bot as active when they make the task active if there's
    // no assignee, we want the agent to make this choice explicitly.
    //
    // NOCOMMIT: Integration test that makes sure the bot can update a task to active
    // when the task is already assigned to another account. Also that the bot can
    // update a task to active and update the assignee at the same time.
    if (newPage.status.type === "Open" && newPage.status.isActive && !newPage.assignee) {
        const assigneeLink: Link = {
            type: "link",
            url: context.botAccount.pathname,
            children: [{type: "text", value: context.botAccount.shortName}],
        };

        if (oldPage.status.type !== "Open" || !oldPage.status.isActive) {
            throw new InvalidArgumentError(
                "Can\u2019t set task as active if there\u2019s no assignee",
                {
                    displayMessage: errorDisplayMessage`Can\u2019t set task as active if there\u2019s no assignee. We don\u2019t recommend setting a task as active unless you\u2019re about to work on the task or you know someone else is currently working on the task. Try again and either set the task as open but inactive (e.g. \`- Status: Open\`) or set an assignee (e.g. \`- Assignee: ${printMarkdownTree(assigneeLink).trim()}\`).`,
                },
            );
        } else {
            throw new InvalidArgumentError("Can\u2019t remove assignee from an active task", {
                displayMessage: errorDisplayMessage`Can\u2019t remove the assignee from an active task. An active task implies someone is currently working on the task and so an assignee is required so we know who that is. Try again but set the task as inactive first (e.g. \`- Status: Open\`).`,
            });
        }
    }

    const patches: Array<ApiTaskPatch> = [];

    if (oldPage.title !== newPage.title) {
        patches.push({type: "SetTitle", title: newPage.title});
    }

    if (
        oldPage.status.type !== newPage.status.type ||
        (oldPage.status.type === "Open" &&
            newPage.status.type === "Open" &&
            oldPage.status.isActive !== newPage.status.isActive)
    ) {
        patches.push({type: "SetStatus", status: newPage.status});
    }

    if (oldPage.parent?.id !== newPage.parent?.id) {
        patches.push({
            type: "SetParent",
            parent: newPage.parent ? {task: {id: newPage.parent.id}} : null,
        });
    }

    if (oldPage.assignee?.id !== newPage.assignee?.id) {
        patches.push({type: "SetAssignee", assignee: newPage.assignee ?? null});
    }

    if (oldPage.dueDateString !== newPage.dueDateString) {
        if (newPage.dueDateString === null) {
            patches.push({type: "SetDue", due: null});
        } else {
            const date = parseAgentWebTaskPageDueDateStringForUpdate(
                contextDate,
                newPage.dueDateString,
            ).toString();

            patches.push({type: "SetDue", due: {date}});
        }
    }

    if (oldPage.priority?.type !== newPage.priority?.type) {
        patches.push({type: "SetPriority", priority: newPage.priority});
    }

    const oldCollectionIds = new Set(oldPage.collections.map(collection => collection.id));
    const newCollectionIds = new Set(newPage.collections.map(collection => collection.id));

    for (const collection of oldPage.collections) {
        if (!newCollectionIds.has(collection.id)) {
            patches.push({type: "RemoveCollection", collectionId: collection.id});
        }
    }

    for (const collection of newPage.collections) {
        if (!oldCollectionIds.has(collection.id)) {
            patches.push({type: "AddCollection", item: {collection}});
        }
    }

    const [, notesPatchResponse] = await runAllPromises([
        patches.length > 0
            ? context.api.patch(context.span, "/tasks/{id}", {
                  params: {path: {id: oldPageMetadata.id}},
                  body: {patches},
              })
            : null,

        !isDeepEqual(normalizeApiContent(oldPage.notes), normalizeApiContent(newPage.notes))
            ? context.api.patch(context.span, "/tasks/{id}/notes", {
                  params: {path: {id: oldPageMetadata.id}},
                  body: {
                      notes: {
                          version: oldPageMetadata.notes.version,
                          content: newPage.notes,
                      },
                  },
              })
            : null,
    ]);

    if (notesPatchResponse) {
        const {keys: notesKeys} = unzipKeysFromApiContentResponse(
            notesPatchResponse.data.notes.content,
        );

        return {
            ...oldPageMetadata,
            notes: {
                version: notesPatchResponse.data.notes.version,
                keys: notesKeys,
            },
        };
    }

    return oldPageMetadata;
}

function parseAgentWebTaskPageDueDateStringForUpdate(
    contextDate: CalendarDate,
    dueDateString: string,
) {
    const matches = parseCalendarDates(dueDateString, contextDate.year);

    if (
        matches.length === 0 ||
        matches.length > 1 ||
        matches[0]!.start !== 0 ||
        matches[0]!.end !== dueDateString.length
    ) {
        const quotedValue = quoteMarkdown([{type: "text", value: dueDateString}]);

        throw new InvalidArgumentError("Invalid task due date", {
            displayMessage: errorDisplayMessage`Unexpected task due date ${quotedValue}. Try again with a date like \u201CJuly 12, 2027\u201D (not including the time, just the date).`,
        });
    }

    return matches[0]!.date;
}

export function normalizeAgentWebTaskPage<Page extends AgentWebTaskPage>(page: Page): Page {
    return produce(page, page => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            if (page.parent) normalizer.normalizeReference(page.parent);
            if (page.assignee) normalizer.normalizeReference(page.assignee);
            for (const collection of page.collections) normalizer.normalizeReference(collection);
            normalizer.normalize(page.notes);
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

    if (page.parent) {
        const {parent} = page;

        listItemPromises.push(
            (async () => ({
                type: "listItem",
                spread: false,
                children: [
                    {
                        type: "paragraph",
                        children: [
                            {type: "text", value: "Parent: "},
                            {
                                type: "link",
                                url: await createAgentWebPageStoredLinkPathname(storage, parent),
                                children: [
                                    {
                                        type: "text",
                                        value: printApiMentionReferenceToMentionLinkLabel(parent),
                                    },
                                ],
                            },
                        ],
                    },
                ],
            }))(),
        );
    }

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

    if (page.dueDateString !== null) {
        listItemPromises.push({
            type: "listItem",
            spread: false,
            children: [
                {
                    type: "paragraph",
                    children: [{type: "text", value: `Due date: ${page.dueDateString}`}],
                },
            ],
        });
    }

    const [listItems, notesRoot] = await runAllPromises([
        runAllPromises(listItemPromises),

        isAgentWebTaskPageNotesEmpty(page.notes)
            ? null
            : (async () => {
                  const notesRoot = await printApiContentToAgentWebMarkdownTree(
                      storage,
                      page.notes,
                  );

                  const traverse = (node: Parent) => {
                      for (const childNode of node.children) {
                          if ("children" in childNode) traverse(childNode);

                          if (childNode.type === "heading") {
                              assert(childNode.depth < 6);
                              childNode.depth = (childNode.depth + 1) as 1 | 2 | 3 | 4 | 5 | 6;
                          }
                      }
                  };

                  traverse(notesRoot);

                  return notesRoot;
              })(),
    ]);

    const children: Root["children"] = [
        {
            type: "heading",
            depth: 1,
            children: [{type: "text", value: page.title}],
        },
        {
            type: "list",
            ordered: false,
            spread: false,
            children: listItems,
        },
    ];

    if (notesRoot) {
        children.push({
            type: "heading",
            depth: 2,
            children: [{type: "text", value: "Notes"}],
        });

        for (const child of notesRoot.children) {
            children.push(child);
        }
    }

    return {
        type: "root",
        children,
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
            title = printMarkdownPhrasingContentText(firstChild.children);
        } else {
            throw new InvalidArgumentError("Missing title in task", {
                displayMessage: errorDisplayMessage`A title is required for tasks. Try again but make sure the task starts with a markdown h1 (e.g. \`# My Task\`).`,
            });
        }
    }

    const createUnexpectedError = () => {
        return new InvalidArgumentError("Expected task fields", {
            displayMessage: errorDisplayMessage`Unexpected markdown on line ${root.children[childIndex]?.position?.start.line ?? "unknown"}. Try again with only allowed sections like fields (an unordered list with items like \`- Priority: Medium\`) or notes (the h2 \`## Notes\` and the content after).`,
        });
    };

    let childIndex = 1;
    let fieldsList: List | null = null;
    let notesChildren: Array<RootContent> | null = null;

    while (childIndex < root.children.length) {
        const nextChild = root.children[childIndex]!;

        if (notesChildren === null && nextChild.type === "list") {
            if (nextChild.ordered) throw createUnexpectedError();
            fieldsList = nextChild;
            childIndex++;
        } else if (
            nextChild.type === "heading" &&
            nextChild.depth === 2 &&
            normalizeAgentWebStaticText(printMarkdownPhrasingContentText(nextChild.children)) ===
                "note"
        ) {
            notesChildren = root.children.slice(childIndex + 1);
            childIndex = root.children.length;
        } else {
            throw createUnexpectedError();
        }
    }

    let status: ApiTaskStatus = {type: "Open", isActive: false};
    let parentPromise: Promise<ApiTaskReferenceResponse | null> | null = null;
    let assigneePromise: Promise<ApiAccountReferenceResponse | null> | null = null;
    let collectionsPromise: Promise<ReadonlyArray<ApiTaskCollectionReferenceResponse>> | null =
        null;
    let priority: ApiTaskPriority | null = null;
    let dueDateString: string | null = null;
    let notesPromise: Promise<ApiContentResponseWithoutKeys> | null = null;

    if (fieldsList !== null) {
        const seenFields = new Set<string>();

        for (const item of fieldsList.children) {
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
            if (remaining.length > 0 && labelKey !== "collect") {
                throw new InvalidArgumentError("Unexpected markdown nested in task field", {
                    displayMessage: errorDisplayMessage`Unexpected markdown after task field \u201C${label}\u201D on line ${remaining[0]!.position?.start.line ?? item.position?.start.line ?? "unknown"}. Try again with an unordered list item for each task field where the field name is followed by the field value with a colon in between (e.g. \`- Priority: Medium\`).`,
                });
            }

            switch (labelKey) {
                case "statu": {
                    status = parseAgentWebTaskPageStatus(item.position, value);
                    break;
                }
                case "parent": {
                    parentPromise = parseAgentWebTaskPageParent(storage, item.position, value);
                    break;
                }
                case "assigne": {
                    assigneePromise = parseAgentWebTaskPageAssignee(storage, item.position, value);
                    break;
                }
                case "collect": {
                    collectionsPromise = parseAgentWebTaskPageCollections(
                        storage,
                        item.position,
                        value,
                        remaining,
                    );
                    break;
                }
                case "prioriti": {
                    priority = parseAgentWebTaskPagePriority(item.position, value);
                    break;
                }
                case "due": {
                    dueDateString = parseAgentWebTaskPageDue(value);
                    break;
                }
                default: {
                    throw new InvalidArgumentError("Unknown task field", {
                        displayMessage: errorDisplayMessage`Unknown task field \u201C${label}\u201D on line ${item.position?.start.line ?? "unknown"}. Try again with one of \u201CStatus\u201D, \u201CParent\u201D, \u201CAssignee\u201D, \u201CCollections\u201D, \u201CPriority\u201D, or \u201CDue date\u201D.`,
                    });
                }
            }
        }
    }

    if (notesChildren !== null) {
        const notesRoot: Root = {
            type: "root",
            children: notesChildren,
        };

        const traverse = (node: Parent) => {
            for (const childNode of node.children) {
                if ("children" in childNode) traverse(childNode);

                if (childNode.type === "heading") {
                    // NOCOMMIT: Throw error if depth is less than 2.

                    childNode.depth = Math.max(childNode.depth - 1, 1) as 1 | 2 | 3 | 4 | 5 | 6;
                }
            }
        };

        traverse(notesRoot);

        notesPromise = parseApiContentFromAgentWebMarkdownTree(storage, notesRoot);
    }

    const [parent, assignee, collections, notes] = await runAllPromises([
        parentPromise,
        assigneePromise,
        collectionsPromise,
        notesPromise,
    ]);

    return {
        type: "Task",
        title,
        status,
        parent,
        assignee,
        collections: collections ?? [],
        priority,
        dueDateString,
        notes: notes ?? {elements: [{type: "Paragraph", elements: []}]},
    };
}

function isAgentWebTaskPageNotesEmpty(notes: ApiContentResponseWithoutKeys): boolean {
    const element = notes.elements[0];

    return (
        notes.elements.length === 1 &&
        element?.type === "Paragraph" &&
        element.elements.length === 0
    );
}

function parseAgentWebTaskPageField(item: ListItem) {
    const firstChild = item.children[0];

    const createError = () => {
        return new InvalidArgumentError("Invalid task fields", {
            displayMessage: errorDisplayMessage`Unexpected markdown on line ${firstChild?.position?.start.line ?? item.position?.start.line ?? "unknown"}. Try again with an unordered list item for each task field where the field name is followed by the field value with a colon in between (e.g. \`- Priority: Medium\`).`,
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

    return {label, value, remaining: item.children.slice(1)};
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

async function parseAgentWebTaskPageParent(
    storage: AgentWebSessionStorage,
    itemPosition: Node["position"],
    value: ReadonlyArray<PhrasingContent>,
): Promise<ApiTaskReferenceResponse | null> {
    const createError = (position: Node["position"]) => {
        const quotedValue = quoteMarkdown(value);

        return new InvalidArgumentError("Invalid task fields", {
            displayMessage: errorDisplayMessage`Unexpected task parent link ${quotedValue} on line ${position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with a link to a task you\u2019ve seen before (e.g. \`[My Task](/task/my-task)\`).`,
        });
    };

    let link: Link | null = null;

    for (const child of value) {
        // NOCOMMIT: test that if there's a second link we should throw
        if (child.type === "link" && link === null) {
            link = child;
            continue;
        }

        if (child.type === "text" && child.value.trim().length === 0) {
            continue;
        }

        throw createError(child.position);
    }

    if (link === null) return null;

    const pageLinkResult = await routeAgentWebPageLinkPathname(storage, link.url);

    if (!pageLinkResult || pageLinkResult.pageLink.type !== "Task") {
        throw createError(link.position);
    }

    return pageLinkResult.pageLink;
}

async function parseAgentWebTaskPageAssignee(
    storage: AgentWebSessionStorage,
    itemPosition: Node["position"],
    value: ReadonlyArray<PhrasingContent>,
): Promise<ApiAccountReferenceResponse | null> {
    const createError = (position: Node["position"]) => {
        const quotedValue = quoteMarkdown(value);

        return new InvalidArgumentError("Invalid task fields", {
            displayMessage: errorDisplayMessage`Unexpected task assignee link ${quotedValue} on line ${position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with a link to a human or bot you\u2019ve seen before (e.g. \`[John](/human/john-doe)\`).`,
        });
    };

    let link: Link | null = null;

    for (const child of value) {
        // NOCOMMIT: if there's a second link we should throw
        if (child.type === "link" && link === null) {
            link = child;
            continue;
        }

        if (child.type === "text" && child.value.trim().length === 0) {
            continue;
        }

        throw createError(child.position);
    }

    if (link === null) return null;

    const pageLinkResult = await routeAgentWebPageLinkPathname(storage, link.url);

    if (!pageLinkResult || pageLinkResult.pageLink.type !== "Account") {
        throw createError(link.position);
    }

    return pageLinkResult.pageLink;
}

async function parseAgentWebTaskPageCollections(
    storage: AgentWebSessionStorage,
    itemPosition: Node["position"],
    value: ReadonlyArray<PhrasingContent>,
    remaining: ReadonlyArray<ListItem["children"][number]>,
): Promise<Array<ApiTaskCollectionReferenceResponse>> {
    const collectionLinks: Array<Link> = [];
    let hasInlineListSyntax = false;

    for (const node of value) {
        switch (node.type) {
            case "link": {
                hasInlineListSyntax = true;
                collectionLinks.push(node);
                break;
            }

            case "text": {
                if (node.value.trim().length > 0) {
                    hasInlineListSyntax = true;
                }

                if (
                    node.value
                        .replace(/,/g, "")
                        .replace(/\band\b/gi, "")
                        .trim().length === 0
                ) {
                    break;
                }

                // Intentional fallthrough to `default` branch...
            }

            default: {
                throw new InvalidArgumentError("Invalid task collections field", {
                    displayMessage: errorDisplayMessage`Unexpected markdown for task collections field on line ${node.position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with a comma separated list of collection links (e.g. \`- Collections: [My Collection 1](/task-collection/my-collection-1), [My Collection 2](/task-collection/my-collection-2)\`).`,
                });
            }
        }
    }

    // If there were just inline collections, great! Otherwise we'll try to parse a
    // nested collection list.
    if (remaining.length === 0) {
        const collectionPromises = collectionLinks.map(async link => {
            const pageLinkResult = await routeAgentWebPageLinkPathname(storage, link.url);

            if (!pageLinkResult || pageLinkResult.pageLink.type !== "TaskCollection") {
                const quotedValue = quoteMarkdown([link]);

                throw new InvalidArgumentError("Invalid task fields", {
                    displayMessage: errorDisplayMessage`Unexpected task collection link ${quotedValue} on line ${link.position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with a link to a task collection you\u2019ve seen before (e.g. \`[My Collection](/task-collection/my-collection)\`).`,
                });
            }

            return pageLinkResult.pageLink;
        });

        return await runAllPromises(collectionPromises);
    }

    const nestedList = remaining[0];

    if (
        hasInlineListSyntax ||
        collectionLinks.length > 0 ||
        remaining.length !== 1 ||
        nestedList!.type !== "list" ||
        nestedList.ordered
    ) {
        throw new InvalidArgumentError("Invalid task collections field", {
            displayMessage: errorDisplayMessage`Unexpected markdown after task collection list on line ${remaining[0]?.position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with a comma separated list of collection links and nothing else after that (e.g. \`- Collections: [My Collection 1](/task-collection/my-collection-1), [My Collection 2](/task-collection/my-collection-2)\`).`,
        });
    }

    for (const nestedItem of nestedList.children) {
        const createError = () => {
            throw new InvalidArgumentError("Invalid task collections field", {
                displayMessage: errorDisplayMessage`Unexpected markdown in task collection list item on line ${nestedItem.position?.start.line ?? "unknown"}. Try again with a single collection link (e.g. \`[My Collection](/task-collection/my-collection)\`) in each nested list item.`,
            });
        };

        const paragraph = nestedItem.children[0];

        if (nestedItem.children.length !== 1 || paragraph?.type !== "paragraph") {
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

        if (link === null) {
            throw createError();
        }

        collectionLinks.push(link);
    }

    const collectionPromises = collectionLinks.map(async link => {
        const pageLinkResult = await routeAgentWebPageLinkPathname(storage, link.url);

        if (!pageLinkResult || pageLinkResult.pageLink.type !== "TaskCollection") {
            const quotedValue = quoteMarkdown([link]);

            throw new InvalidArgumentError("Invalid task fields", {
                displayMessage: errorDisplayMessage`Unexpected task collection link ${quotedValue} on line ${link.position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with a link to a task collection you\u2019ve seen before (e.g. \`[My Collection](/task-collection/my-collection)\`).`,
            });
        }

        return pageLinkResult.pageLink;
    });

    return await runAllPromises(collectionPromises);
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
                // We intentionally don't include "Urgent" in the list of valid priorities here.
                // "Urgent" is a secret priority we'll mention in skills. Very few tasks should
                // have an "Urgent" priority as urgent tasks will constantly notify the owner that
                // the task is still open.
                displayMessage: errorDisplayMessage`Unexpected task priority ${quotedValue} on line ${value[0]?.position?.start.line ?? itemPosition?.start.line ?? "unknown"}. Try again with \u201CLow\u201D, \u201CMedium\u201D, or \u201CHigh\u201D.`,
            });
        }
    }
}

function parseAgentWebTaskPageDue(value: ReadonlyArray<PhrasingContent>): string | null {
    const dateString = printMarkdownPhrasingContentText(value).trim();
    if (dateString.length === 0) return null;
    return dateString;
}
