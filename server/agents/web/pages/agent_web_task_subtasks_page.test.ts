import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {AgentWebTaskQueryPageTask} from "~/server/agents/web/pages/agent_web_task_query_page.js";
import {
    AgentWebTaskSubtasksPage,
    normalizeAgentWebTaskSubtasksPage,
    parseAgentWebTaskSubtasksPage,
    printAgentWebTaskSubtasksPage,
} from "~/server/agents/web/pages/agent_web_task_subtasks_page.js";
import {runAgentWebPageTests} from "~/server/agents/web/test_helpers/run_agent_web_page_tests.js";
import {
    ApiAccountReferenceResponse,
    ApiTaskCollectionReferenceResponse,
    ApiTaskReferenceResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

const parentTaskReference: ApiTaskReferenceResponse = {
    type: "Task",
    id: generateId<TaskId>(),
    title: "Plan launch",
    status: {type: "Open", isActive: false},
};

const activeParentTaskReference: ApiTaskReferenceResponse = {
    ...parentTaskReference,
    status: {type: "Open", isActive: true},
};

const writeSpecTaskReference: ApiTaskReferenceResponse = {
    type: "Task",
    id: generateId<TaskId>(),
    title: "Write spec",
    status: {type: "Open", isActive: false},
};

const activeWriteSpecTaskReference: ApiTaskReferenceResponse = {
    ...writeSpecTaskReference,
    status: {type: "Open", isActive: true},
};

const shipLaunchTaskReference: ApiTaskReferenceResponse = {
    type: "Task",
    id: generateId<TaskId>(),
    title: "Ship launch",
    status: {type: "Closed"},
};

const otherParentTaskReference: ApiTaskReferenceResponse = {
    type: "Task",
    id: generateId<TaskId>(),
    title: "Other parent",
    status: {type: "Open", isActive: false},
};

const aliceReference: ApiAccountReferenceResponse = {
    type: "Account",
    id: generateId<AccountId>(),
    title: "Alice",
    shortName: "Alice",
};

const engineeringReference: ApiTaskCollectionReferenceResponse = {
    type: "TaskCollection",
    id: generateId<TaskCollectionId>(),
    title: "Engineering",
};

function subtaskPageTask(
    task: ApiTaskReferenceResponse,
    fields: Partial<Omit<AgentWebTaskQueryPageTask, "taskId" | "title" | "status">> = {},
): AgentWebTaskQueryPageTask {
    return {
        taskId: task.id,
        title: task.title,
        status: task.status,
        parent: null,
        subtasks: {openTaskCount: 0, closedTaskCount: 0},
        assignee: null,
        collections: [],
        additionalCollectionsCount: 0,
        priority: null,
        dueDateString: null,
        ...fields,
    };
}

async function storeTaskReference(
    storage: AgentWebSessionStorage,
    task: ApiTaskReferenceResponse,
): Promise<void> {
    await createAgentWebPageStoredLinkPathname(storage, task);
}

runAgentWebPageTests<TaskId, AgentWebTaskSubtasksPage>({
    print: printAgentWebTaskSubtasksPage,
    parse: parseAgentWebTaskSubtasksPage,
    normalize: normalizeAgentWebTaskSubtasksPage,
    tests: [
        {
            name: "task subtasks page",
            pageLink: parentTaskReference.id,
            markdown: `\
Subtasks for [Plan launch (Open)](/task/plan-launch).

- [Write spec (Open)](/task/write-spec)

- [Ship launch (Closed)](/task/ship-launch)
`,
            page: {
                type: "TaskSubtasks",
                task: parentTaskReference,
                pagination: null,
                tasks: [
                    subtaskPageTask(writeSpecTaskReference),
                    subtaskPageTask(shipLaunchTaskReference),
                ],
                isEndOfTasks: false,
            },
        },
        {
            name: "empty task subtasks page at the end of tasks",
            pageLink: parentTaskReference.id,
            markdown: `\
Subtasks for [Plan launch (Open)](/task/plan-launch).

End of tasks.
`,
            page: {
                type: "TaskSubtasks",
                task: parentTaskReference,
                pagination: null,
                tasks: [],
                isEndOfTasks: true,
            },
        },
        {
            name: "task subtasks preamble without a period",
            pageLink: parentTaskReference.id,
            markdown: `\
Subtasks for [Plan launch (Open)](/task/plan-launch)
`,
            printMarkdown: `\
Subtasks for [Plan launch (Open)](/task/plan-launch).
`,
            page: {
                type: "TaskSubtasks",
                task: parentTaskReference,
                pagination: null,
                tasks: [],
                isEndOfTasks: false,
            },
        },
        {
            name: "task subtasks page with a filtered and sorted next page link",
            pageLink: parentTaskReference.id,
            markdown: `\
Subtasks for [Plan launch (Open)](/task/plan-launch). [Next page »](/task/plan-launch/subtasks?after=a1b2c3&status=open&sort=-priority,due)

- [Write spec (Open)](/task/write-spec)
`,
            page: {
                type: "TaskSubtasks",
                task: parentTaskReference,
                pagination: {
                    nextCursorHash: "a1b2c3",
                    query: {
                        filters: [
                            {
                                type: "Status",
                                operation: {
                                    type: "OneOf",
                                    statuses: [
                                        {type: "Open", isActive: false},
                                        {type: "Open", isActive: true},
                                    ],
                                },
                            },
                        ],
                        sorts: [
                            {type: "Priority", direction: "Descending"},
                            {type: "Due", direction: "Ascending"},
                        ],
                    },
                },
                tasks: [subtaskPageTask(writeSpecTaskReference)],
                isEndOfTasks: false,
            },
        },
        {
            name: "task subtasks page with all task fields",
            pageLink: parentTaskReference.id,
            markdown: `\
Subtasks for [Plan launch (Open)](/task/plan-launch).

- [Write spec (Open)](/task/write-spec)
  - Parent: [Other parent](/task/other-parent)
  - Subtasks: 3 open, 4 closed
  - Assignee: [Alice](/human/alice)
  - Collections: [Engineering](/task-collection/engineering) and 2 more
  - Priority: High
  - Due date: July 12th, 2027
`,
            printMarkdown: `\
Subtasks for [Plan launch (Open)](/task/plan-launch).

- [Write spec (Open)](/task/write-spec)
  - Parent: [Other parent](/task/other-parent)
  - Subtasks: 3 open, 4 closed
  - Assignee: [Alice](/human/alice)
  - Collections: [Engineering](/task-collection/engineering), and 2 more
  - Priority: High
  - Due date: July 12th, 2027
`,
            page: {
                type: "TaskSubtasks",
                task: parentTaskReference,
                pagination: null,
                tasks: [
                    subtaskPageTask(writeSpecTaskReference, {
                        parent: otherParentTaskReference,
                        subtasks: {openTaskCount: 3, closedTaskCount: 4},
                        assignee: aliceReference,
                        collections: [engineeringReference],
                        additionalCollectionsCount: 2,
                        priority: {type: "High"},
                        dueDateString: "July 12th, 2027",
                    }),
                ],
                isEndOfTasks: false,
            },
        },
        {
            name: "active statuses are parsed case insensitively",
            pageLink: parentTaskReference.id,
            markdown: `\
subtasks for [Plan launch (oPeN, AcTiVe)](/task/plan-launch).

- [Write spec (OPEN, ACTIVE)](/task/write-spec)
`,
            printMarkdown: `\
Subtasks for [Plan launch (Open, active)](/task/plan-launch).

- [Write spec (Open, active)](/task/write-spec)
`,
            page: {
                type: "TaskSubtasks",
                task: activeParentTaskReference,
                pagination: null,
                tasks: [subtaskPageTask(activeWriteSpecTaskReference)],
                isEndOfTasks: false,
            },
        },
        {
            name: "invalid task subtasks preamble",
            pageLink: parentTaskReference.id,
            markdown: `\
# Plan launch
`,
            parseError:
                "Subtasks markdown must start with \u201cSubtasks for [My Task (Open)]" +
                "(/task/my-task).\u201d on line 1 (substitute \u201cMy Task\u201d for the task " +
                "you\u2019re looking at the subtasks for). Try again with a valid task " +
                "subtasks preamble on line 1.",
        },
        {
            name: "next page link without an after cursor",
            pageLink: parentTaskReference.id,
            setupStorage: async storage => {
                await storeTaskReference(storage, parentTaskReference);
            },
            markdown: `\
Subtasks for [Plan launch (Open)](/task/plan-launch). [Next page »](/task/plan-launch/subtasks)
`,
            parseError:
                "Subtasks markdown must start with \u201cSubtasks for [My Task (Open)]" +
                "(/task/my-task).\u201d on line 1 (substitute \u201cMy Task\u201d for the task " +
                "you\u2019re looking at the subtasks for). Try again with a valid task " +
                "subtasks preamble on line 1.",
        },
        {
            name: "unexpected paragraph after the preamble",
            pageLink: parentTaskReference.id,
            setupStorage: async storage => {
                await storeTaskReference(storage, parentTaskReference);
            },
            markdown: `\
Subtasks for [Plan launch (Open)](/task/plan-launch).

Unexpected paragraph.
`,
            parseError:
                "Unexpected markdown on line 3. Try again with \u201cSubtasks for " +
                "[My Task (Open)](/task/my-task).\u201d on line 1 followed by a task list " +
                "(an unordered list where every item is a task link).",
        },
        {
            name: "ordered task list",
            pageLink: parentTaskReference.id,
            setupStorage: async storage => {
                await storeTaskReference(storage, parentTaskReference);
            },
            markdown: `\
Subtasks for [Plan launch (Open)](/task/plan-launch).

1. [Write spec (Open)](/task/write-spec)
`,
            parseError:
                "Unexpected markdown on line 3. Try again with \u201cSubtasks for " +
                "[My Task (Open)](/task/my-task).\u201d on line 1 followed by a task list " +
                "(an unordered list where every item is a task link).",
        },
        {
            name: "content after the end of tasks marker",
            pageLink: parentTaskReference.id,
            setupStorage: async storage => {
                await storeTaskReference(storage, parentTaskReference);
            },
            markdown: `\
Subtasks for [Plan launch (Open)](/task/plan-launch).

End of tasks.

Unexpected paragraph.
`,
            parseError:
                "Nothing may appear after \u201CEnd of tasks\u201D in subtasks markdown. Try again " +
                "after removing the extra content after \u201CEnd of tasks\u201D on line 5.",
        },
    ],
});
