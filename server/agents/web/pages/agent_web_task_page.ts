import {CalendarDate, fromDate, toCalendarDate} from "@internationalized/date";
import {produce} from "immer";
import {Link, List, Parent, Root, RootContent} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {normalizeAgentWebStaticText} from "~/server/agents/web/internal/normalize_agent_web_static_text.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.js";
import {
    formatAgentWebTaskDueDateString,
    parseAgentWebTaskFieldListItems,
    printAgentWebTaskFieldListItems,
} from "~/server/agents/web/pages/agent_web_task_fields.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {normalizeApiContent} from "~/shared/api/content/normalize_api_content.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.js";
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
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {parseCalendarDates} from "~/shared/helpers/date/parse_calendar_dates.js";
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
        dueDateString: task.due
            ? formatAgentWebTaskDueDateString(context.timeZone, contextDate, task.due)
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
                      patches: [
                          {
                              type: "SetContent",
                              version: oldPageMetadata.notes.version,
                              content: newPage.notes,
                          },
                      ],
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

export function parseAgentWebTaskPageDueDateStringForUpdate(
    contextDate: CalendarDate,
    dueDateString: string,
    additionalDetail: () => ErrorDisplayMessage = () => errorDisplayMessage``,
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
            displayMessage: errorDisplayMessage`Unexpected task due date ${quotedValue}${additionalDetail()}. Try again with a date like \u201CJuly 12, 2027\u201D (not including the time, just the date).`,
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
    const [listItems, notesRoot] = await runAllPromises([
        runAllPromises(printAgentWebTaskFieldListItems(storage, page)),

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

    let notesPromise: Promise<ApiContentResponseWithoutKeys> | null = null;

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

    const [fields, notes] = await runAllPromises([
        fieldsList !== null
            ? parseAgentWebTaskFieldListItems(storage, fieldsList.children, [
                  "status",
                  "parent",
                  "assignee",
                  "collections",
                  "priority",
                  "dueDateString",
              ])
            : null,
        notesPromise,
    ]);

    return {
        type: "Task",
        title,
        status: fields?.status ?? {type: "Open", isActive: false},
        parent: fields?.parent ?? null,
        assignee: fields?.assignee ?? null,
        collections: fields?.collections ?? [],
        priority: fields?.priority ?? null,
        dueDateString: fields?.dueDateString ?? null,
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
