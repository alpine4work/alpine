import {fromDate, toCalendarDate} from "@internationalized/date";
import {produce} from "immer";
import {Link, List, Parent, Root, RootContent} from "mdast";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {createAgentWebTaskQueryCursorHash} from "~/server/agents/web/agent_web_task_query_cursor_hash.open_source.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.open_source.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.open_source.js";
import {normalizeAgentWebStaticText} from "~/server/agents/web/internal/normalize_agent_web_static_text.open_source.js";
import {withApiContentNormalizerForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.open_source.js";
import {
    formatAgentWebTaskDueDateString,
    parseAgentWebTaskFieldListItems,
    printAgentWebTaskFieldListItems,
} from "~/server/agents/web/pages/agent_web_task_fields.open_source.js";
import {
    AgentWebTaskQueryPageMetadata,
    AgentWebTaskQueryPageTask,
    intoAgentWebTaskQueryPageTask,
    normalizeAgentWebTaskQueryPage,
    parseAgentWebTaskQueryPageTasks,
    printAgentWebTaskQueryPageTaskList,
    updateAgentWebTaskQueryPage,
} from "~/server/agents/web/pages/agent_web_task_query_page.open_source.js";
import {parseAgentWebTaskPageDueDateStringForUpdate} from "~/server/agents/web/pages/parse_agent_web_task_page_due_date_string_for_update.open_source.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.open_source.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.open_source.js";
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.open_source.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.open_source.js";
import {normalizeApiContent} from "~/shared/api/content/normalize_api_content.open_source.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.open_source.js";
import {unzipKeysFromApiContentResponse} from "~/shared/api/content/zip_or_unzip_keys_from_api_content_response.open_source.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.open_source.js";
import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.open_source.js";
import {
    ApiAccountReferenceResponse,
    ApiContentResponseWithoutKeys,
    ApiMentionReferenceResponse,
    ApiTaskCollectionReferenceResponse,
    ApiTaskDue,
    ApiTaskPatch,
    ApiTaskPriority,
    ApiTaskReferenceResponse,
    ApiTaskStatus,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {omitObject} from "~/shared/helpers/object/omit_object.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {TaskId} from "~/shared/id/types/id_types.open_source.js";

const agentWebTaskPageSubtaskLimit = 50;

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
    readonly subtasks: AgentWebTaskPageSubtasks | null;
};

export type AgentWebTaskPageSubtasks = {
    readonly tasks: ReadonlyArray<AgentWebTaskQueryPageTask>;
    readonly seeMore: {
        readonly nextCursorHash: string;
        readonly remainingTaskCount: number;
    } | null;
};

export type AgentWebTaskPageMetadata = {
    readonly type: "Task";
    readonly id: TaskId;
    readonly notes: {
        readonly version: number;
        readonly keys: ReadonlyArray<ApiContentKey>;
    };
    readonly subtasks: AgentWebTaskQueryPageMetadata;
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
        data: {task, tasks: loadedSubtasks},
    } = await context.api.get(context.span, "/tasks/{id}-with-notes/subtasks", {
        params: {
            path: {id},
            query: {limit: agentWebTaskPageSubtaskLimit + 1},
        },
    });

    const {content: notes, keys: notesKeys} = unzipKeysFromApiContentResponse(task.notes.content);

    const subtaskCount = task.subtasks.openTaskCount + task.subtasks.closedTaskCount;
    const visibleSubtasks = loadedSubtasks.slice(0, agentWebTaskPageSubtaskLimit);
    const lookaheadSubtask = loadedSubtasks[agentWebTaskPageSubtaskLimit] ?? null;

    const subtasksMetadata: AgentWebTaskQueryPageMetadata = {
        afterCursor: null,
        beforeCursor: lookaheadSubtask?.cursor ?? null,
        isManuallyOrdered: true,
        tasks: visibleSubtasks.map(({cursor}) => ({cursor, newTaskId: null})),
    };

    let subtasks: AgentWebTaskPageSubtasks | null = null;

    if (visibleSubtasks.length > 0) {
        const remainingTaskCount = Math.max(0, subtaskCount - visibleSubtasks.length);

        subtasks = {
            tasks: visibleSubtasks.map(({task: subtask}) =>
                intoAgentWebTaskQueryPageTask({
                    timeZone: context.timeZone,
                    contextDate,
                    omittedParentTaskId: id,
                    task: subtask,
                }),
            ),
            seeMore:
                remainingTaskCount === 0
                    ? null
                    : {
                          nextCursorHash: await createAgentWebTaskQueryCursorHash(
                              context.storage,
                              `Task:${id}`,
                              assertExists(visibleSubtasks[visibleSubtasks.length - 1]).cursor,
                          ),
                          remainingTaskCount,
                      },
        };
    }

    const page: AgentWebTaskPage = {
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
        subtasks,
    };

    return {
        response: await printPage(page),
        metadata: {
            type: "Task",
            id,
            notes: {
                version: task.notes.version,
                keys: notesKeys,
            },
            subtasks: subtasksMetadata,
        },
    };
}

export async function createAgentWebTaskPage(
    context: AgentWebContext,
    newPage: AgentWebTaskPage,
    {addAdditionalOutput}: {addAdditionalOutput: (output: string) => void},
): Promise<{
    pageMetadata: AgentWebTaskPageMetadata;
    pageLink: Extract<ApiMentionReferenceResponse, {readonly type: "Task"}>;
}> {
    const contextTime = new Date();
    const contextDate = toCalendarDate(fromDate(contextTime, context.timeZone));

    if (newPage.subtasks?.seeMore !== null && newPage.subtasks !== null) {
        throw new InvalidArgumentError("Can\u2019t create task with a subtasks pagination link", {
            displayMessage: errorDisplayMessage`You can\u2019t create a task with a \u201cSee more\u201d subtasks link. Try again after removing the link.`,
        });
    }

    let due: ApiTaskDue | null = null;

    // Force the agent to set an assignee if they're marking a task as active. By
    // default our API sets the bot as active when they make the task active if there's
    // no assignee, we want the agent to make this choice explicitly.
    if (newPage.status.type === "Open" && newPage.status.isActive && !newPage.assignee) {
        const assigneeLink: Link = {
            type: "link",
            url: context.botAccount.pathname,
            children: [{type: "text", value: context.botAccount.shortName}],
        };

        throw new InvalidArgumentError(
            "Can\u2019t set task as active if there\u2019s no assignee",
            {
                displayMessage: errorDisplayMessage`Can\u2019t set task as active if there\u2019s no assignee. We don\u2019t recommend setting a task as active unless you\u2019re about to work on the task or you know someone else is currently working on the task. Try again and either set the task as open but inactive (e.g. \`- Status: Open\`) or set an assignee (e.g. ${quote(`- Assignee: ${printMarkdownTree(assigneeLink).trim()}`)}).`,
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

    const emptySubtaskMetadata: AgentWebTaskQueryPageMetadata = {
        afterCursor: null,
        beforeCursor: null,
        isManuallyOrdered: true,
        tasks: [],
    };

    let executeSubtasksUpdate:
        | ((pageLink: {
              type: "TaskSubtasks";
              task: {id: TaskId};
          }) => Promise<AgentWebTaskQueryPageMetadata>)
        | null = null;

    if (newPage.subtasks !== null && newPage.subtasks.tasks.length > 0) {
        ({execute: executeSubtasksUpdate} = await updateAgentWebTaskQueryPage(
            context,
            {type: "TaskSubtasks", task: {id: null}},
            emptySubtaskMetadata,
            {pagination: null, tasks: [], isEndOfTasks: true},
            {pagination: null, tasks: newPage.subtasks.tasks, isEndOfTasks: true},
            {addAdditionalOutput},
        ));
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
                notes: isAgentWebTaskPageNotesEmpty(newPage.notes)
                    ? undefined
                    : {content: newPage.notes},
            },
        },
    });

    const {keys: notesKeys} = unzipKeysFromApiContentResponse(task.notes.content);

    let subtaskMetadata = emptySubtaskMetadata;

    if (executeSubtasksUpdate) {
        subtaskMetadata = await executeSubtasksUpdate({type: "TaskSubtasks", task: {id: task.id}});
    }

    return {
        pageMetadata: {
            type: "Task",
            id: task.id,
            notes: {
                version: task.notes.version,
                keys: notesKeys,
            },
            subtasks: subtaskMetadata,
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
    context: AgentWebContext,
    oldPageMetadata: AgentWebTaskPageMetadata,
    oldPage: AgentWebTaskPage,
    newPage: AgentWebTaskPage,
    {addAdditionalOutput}: {addAdditionalOutput: (output: string) => void},
): Promise<AgentWebTaskPageMetadata> {
    const contextTime = new Date();
    const contextDate = toCalendarDate(fromDate(contextTime, context.timeZone));

    if (!isDeepEqual(oldPage.subtasks?.seeMore ?? null, newPage.subtasks?.seeMore ?? null)) {
        throw new InvalidArgumentError("Can\u2019t update task subtasks pagination", {
            displayMessage: errorDisplayMessage`You can\u2019t update the \u201cSee more\u201d link in a task\u2019s subtasks section. Try again with a more specific update that leaves the \u201cSee more\u201d link unchanged.`,
        });
    }

    // Force the agent to set an assignee if they're marking a task as active. By
    // default our API sets the bot as active when they make the task active if there's
    // no assignee, we want the agent to make this choice explicitly.
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
                    displayMessage: errorDisplayMessage`Can\u2019t set task as active if there\u2019s no assignee. We don\u2019t recommend setting a task as active unless you\u2019re about to work on the task or you know someone else is currently working on the task. Try again and either set the task as open but inactive (e.g. \`- Status: Open\`) or set an assignee (e.g. ${quote(`- Assignee: ${printMarkdownTree(assigneeLink).trim()}`)}).`,
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

    if (oldPage.parent?.id !== newPage.parent?.id) {
        patches.push({
            type: "SetParent",
            parent: newPage.parent ? {task: {id: newPage.parent.id}} : null,
        });
    }

    if (oldPage.assignee?.id !== newPage.assignee?.id) {
        patches.push({
            type: "SetAssignee",
            assignee: newPage.assignee ? {id: newPage.assignee.id} : null,
        });
    }

    // Setting an assignee resets the assignee's status, so apply the requested status
    // afterwards when both fields change.
    if (
        oldPage.status.type !== newPage.status.type ||
        (oldPage.status.type === "Open" &&
            newPage.status.type === "Open" &&
            oldPage.status.isActive !== newPage.status.isActive)
    ) {
        patches.push({type: "SetStatus", status: newPage.status});
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
            patches.push({
                type: "AddCollection",
                item: {collection: {id: collection.id}},
            });
        }
    }

    const {execute: executeSubtasksUpdate} = await updateAgentWebTaskQueryPage(
        context,
        {type: "TaskSubtasks", task: {id: oldPageMetadata.id}},
        oldPageMetadata.subtasks,
        {
            pagination: null,
            tasks: oldPage.subtasks?.tasks ?? [],
            isEndOfTasks: oldPageMetadata.subtasks.beforeCursor === null,
        },
        {
            pagination: null,
            tasks: newPage.subtasks?.tasks ?? [],
            isEndOfTasks: oldPageMetadata.subtasks.beforeCursor === null,
        },
        {addAdditionalOutput},
    );

    const [, notesPatchResponse, subtasksMetadata] = await runAllPromises([
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

        executeSubtasksUpdate({type: "TaskSubtasks", task: {id: oldPageMetadata.id}}),
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
            subtasks: subtasksMetadata,
        };
    }

    return {...oldPageMetadata, subtasks: subtasksMetadata};
}

export function normalizeAgentWebTaskPage<Page extends AgentWebTaskPage>(page: Page): Page {
    return produce(page, page => {
        withApiContentNormalizerForAgentWebMarkdown(normalizer => {
            if (page.parent) normalizer.normalizeReference(page.parent);
            if (page.assignee) normalizer.normalizeReference(page.assignee);
            for (const collection of page.collections) normalizer.normalizeReference(collection);
            normalizer.normalize(page.notes);

            if (page.subtasks !== null) {
                normalizeAgentWebTaskQueryPage(normalizer, {tasks: page.subtasks.tasks});
            }
        });
    });
}

export async function printAgentWebTaskPage(
    storage: AgentWebSessionStorage,
    id: TaskId,
    page: AgentWebTaskPage,
): Promise<Root> {
    const [listItems, notesRoot, subtaskList, taskPathname] = await runAllPromises([
        runAllPromises(printAgentWebTaskFieldListItems(storage, omitObject(page, ["subtasks"]))),

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

        page.subtasks === null
            ? null
            : printAgentWebTaskQueryPageTaskList(storage, "TaskSubtasks", page.subtasks.tasks),

        page.subtasks?.seeMore === null || page.subtasks === null
            ? null
            : createAgentWebPageStoredLinkPathname(storage, {
                  type: "Task",
                  id,
                  title: page.title,
                  status: page.status,
              }),
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

    if (page.subtasks !== null) {
        assert(subtaskList !== null);

        children.push(
            {
                type: "heading",
                depth: 2,
                children: [{type: "text", value: "Subtasks"}],
            },
            subtaskList,
        );

        if (page.subtasks.seeMore !== null) {
            assert(taskPathname !== null);

            children.push({
                type: "paragraph",
                children: [
                    {
                        type: "link",
                        url: `${taskPathname}/subtasks?after=${page.subtasks.seeMore.nextCursorHash}`,
                        children: [
                            {
                                type: "text",
                                value: `See more (${page.subtasks.seeMore.remainingTaskCount} remaining) »`,
                            },
                        ],
                    },
                ],
            });
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

    const createUnexpectedError = (child: RootContent) => {
        return new InvalidArgumentError("Expected task fields", {
            displayMessage: errorDisplayMessage`Unexpected markdown on line ${child?.position?.start.line ?? "unknown"}. Try again with only allowed sections like fields (an unordered list with items like \`- Priority: Medium\`), notes (the h2 \`## Notes\` and the content after), or subtasks (the h2 \`## Subtasks\` and an unordered task list) in that exact order (fields, notes, subtasks).`,
        });
    };

    let childIndex = 1;
    let fieldsList: List | null = null;
    let notesChildren: Array<RootContent> | null = null;
    let subtasksChildren: Array<RootContent> | null = null;

    while (childIndex < root.children.length) {
        const nextChild = root.children[childIndex]!;

        if (
            notesChildren === null &&
            subtasksChildren === null &&
            fieldsList === null &&
            nextChild.type === "list"
        ) {
            if (nextChild.ordered) throw createUnexpectedError(nextChild);
            fieldsList = nextChild;
            childIndex++;
        } else if (
            notesChildren === null &&
            subtasksChildren === null &&
            nextChild.type === "heading" &&
            nextChild.depth === 2 &&
            normalizeAgentWebStaticText(printMarkdownPhrasingContentText(nextChild.children)) ===
                "note"
        ) {
            const endOffset = root.children
                .slice(childIndex + 1)
                .findIndex(otherChild => otherChild.type === "heading" && otherChild.depth <= 2);

            if (endOffset === -1) {
                notesChildren = root.children.slice(childIndex + 1);
                childIndex = root.children.length;
            } else {
                const endIndex = childIndex + 1 + endOffset;
                notesChildren = root.children.slice(childIndex + 1, endIndex);
                childIndex = endIndex;
            }
        } else if (
            subtasksChildren === null &&
            nextChild.type === "heading" &&
            nextChild.depth === 2 &&
            normalizeAgentWebStaticText(printMarkdownPhrasingContentText(nextChild.children)) ===
                "subtask"
        ) {
            const endOffset = root.children
                .slice(childIndex + 1)
                .findIndex(otherChild => otherChild.type === "heading" && otherChild.depth <= 2);

            if (endOffset === -1) {
                subtasksChildren = root.children.slice(childIndex + 1);
                childIndex = root.children.length;
            } else {
                const endIndex = childIndex + 1 + endOffset;
                subtasksChildren = root.children.slice(childIndex + 1, endIndex);
                childIndex = endIndex;
            }
        } else {
            throw createUnexpectedError(nextChild);
        }
    }

    let subtaskList: List | null = null;
    let seeMoreNode: RootContent | null = null;

    if (subtasksChildren !== null && subtasksChildren.length > 0) {
        const firstSectionChild = subtasksChildren[0]!;

        if (
            firstSectionChild.type !== "list" ||
            firstSectionChild.ordered ||
            firstSectionChild.children.length === 0
        ) {
            throw createUnexpectedError(firstSectionChild);
        }

        subtaskList = firstSectionChild;
        seeMoreNode = subtasksChildren[1] ?? null;

        if (subtasksChildren.length > 2) throw createUnexpectedError(subtasksChildren[2]!);
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
                    childNode.depth = Math.max(childNode.depth - 1, 1) as 1 | 2 | 3 | 4 | 5 | 6;
                }
            }
        };

        traverse(notesRoot);

        notesPromise = parseApiContentFromAgentWebMarkdownTree(storage, notesRoot);
    }

    const [fields, notes, subtaskTasks, seeMore] = await runAllPromises([
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
        parseAgentWebTaskQueryPageTasks(storage, "TaskSubtasks", subtaskList),
        seeMoreNode === null
            ? null
            : parseAgentWebTaskPageSubtasksSeeMore(storage, id, seeMoreNode),
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
        subtasks: subtaskList === null ? null : {tasks: subtaskTasks, seeMore},
    };
}

async function parseAgentWebTaskPageSubtasksSeeMore(
    storage: AgentWebSessionStorage,
    id: TaskId | null,
    node: RootContent,
): Promise<NonNullable<AgentWebTaskPageSubtasks["seeMore"]>> {
    const link =
        node.type === "paragraph" && node.children.length === 1 && node.children[0]?.type === "link"
            ? node.children[0]
            : null;

    const label = link === null ? "" : printMarkdownPhrasingContentText(link.children);
    const labelMatch = label.match(/^See more \(([1-9][0-9]*) remaining\) »$/);

    if (link !== null && labelMatch !== null) {
        const {pathname, searchParams} = normalizeAgentWebPath(link.url);
        const pageLinkResult = await routeAgentWebPageLinkPathname(storage, pathname);
        const nextCursorHash = searchParams.get("after");

        if (
            pageLinkResult?.pageLink.type === "TaskSubtasks" &&
            nextCursorHash !== null &&
            Array.from(searchParams.keys()).length === 1
        ) {
            if (id === null) {
                throw new InvalidArgumentError(
                    "Can\u2019t create task with a subtasks pagination link",
                    {
                        displayMessage: errorDisplayMessage`You can\u2019t create a task with a \u201cSee more\u201d subtasks link. Try again after removing the link.`,
                    },
                );
            }

            if (pageLinkResult.pageLink.task.id === id) {
                return {
                    nextCursorHash,
                    remainingTaskCount: Number(labelMatch[1]),
                };
            }
        }
    }

    throw new InvalidArgumentError("Invalid task page subtasks See more link", {
        displayMessage: errorDisplayMessage`Expected a task\u2019s subtasks section to end with a valid \u201cSee more »\u201d link with an \`?after\` URL search param to the task\u2019s subtasks page. Try again with the \u201cSee more\u201d link from the task page you read.`,
    });
}

function isAgentWebTaskPageNotesEmpty(notes: ApiContentResponseWithoutKeys): boolean {
    const element = notes.elements[0];

    return (
        notes.elements.length === 1 &&
        element?.type === "Paragraph" &&
        element.elements.length === 0
    );
}
