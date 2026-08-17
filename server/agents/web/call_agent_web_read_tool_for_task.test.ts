import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {createApiTaskMock} from "~/server/agents/api/test_helpers/create_api_task_mock.js";
import {printApiTaskQueryCursorMock} from "~/server/agents/api/test_helpers/mock_api_get_task_collection_tasks.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {createAgentWebTaskQueryCursorHash} from "~/server/agents/web/agent_web_task_query_cursor_hash.open_source.js";
import {callAgentWebReadTool as actuallyCallAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {
    ApiContentResponseWithoutKeys,
    ApiTaskResponse,
    ApiTaskWithNotesResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    BotId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

async function callAgentWebReadTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebReadTool>
): Promise<string> {
    const result = await actuallyCallAgentWebReadTool(...callArguments);
    assert(result.response.type === "String");
    return result.response.string;
}

const {span} = testTracer.startSpan("call_agent_web_read_tool_for_task.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);

const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();

const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        id: botAccountId,
        bot: {id: botId},
    },
};

const emptyNotesContent: ApiContentResponseWithoutKeys = {
    elements: [{type: "Paragraph", elements: []}],
};

function mockGetTask(
    api: ApiClientMock,
    spaceId: SpaceId,
    taskId: TaskId,
    responseData: Omit<ApiTaskWithNotesResponse, "id">,
    subtasks: ReadonlyArray<ApiTaskWithNotesResponse> = [],
): void {
    api.mockGet("/tasks/{id}-with-notes/subtasks", {
        params: {path: {id: taskId}, query: {limit: 51}},
        data: {
            spaceId,
            task: {
                id: taskId,
                ...responseData,
            },
            nextCursor: null,
            tasks: subtasks.map((task, index) => ({
                cursor: printApiTaskQueryCursorMock(index),
                task: withoutNotes(task),
            })),
        },
    });
}

test("reads full task page", async () => {
    const taskId = generateId<TaskId>();
    const parentTaskId = generateId<TaskId>();
    const engineeringCollectionId = generateId<TaskCollectionId>();
    const roadmapCollectionId = generateId<TaskCollectionId>();
    const aliceAccount = createApiAccountMock({name: "Alice"});

    await storeAgentWebPageLinkForTest(storage, {
        type: "Task",
        id: taskId,
        title: "Ship task page",
        status: {type: "Open", isActive: true},
    });

    mockGetTask(api, spaceId, taskId, {
        title: "Ship task page",
        status: {type: "Open", isActive: true},
        layout: {type: "Project"},
        parent: {
            task: {
                id: parentTaskId,
                title: "Parent task",
                status: {type: "Open", isActive: false},
            },
        },
        assignee: aliceAccount,
        collections: [
            {collection: {id: engineeringCollectionId, name: "Engineering"}},
            {collection: {id: roadmapCollectionId, name: "Roadmap"}},
        ],
        subtasks: {openTaskCount: 0, closedTaskCount: 0},
        priority: {type: "Urgent"},
        due: {date: "2025-07-12"},
        notes: {
            version: 3,
            content: addKeysToApiContentForTest({
                elements: [
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text: "Read rollout notes."}],
                    },
                    {
                        type: "Heading",
                        level: 1,
                        elements: [{type: "Text", text: "Context"}],
                    },
                    {
                        type: "Paragraph",
                        elements: [{type: "Text", text: "Ship behind a flag."}],
                    },
                ],
            }),
        },
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/task/ship-task-page",
            limit: "10kb",
        }),
    ).toEqual(`\
# Ship task page

- Status: Open (active)
- Layout: Project
- Parent: [Parent task](/task/parent-task)
- Assignee: [Alice](/human/alice)
- Collections: [Engineering](/task-collection/engineering), [Roadmap](/task-collection/roadmap)
- Priority: Urgent
- Due date: July 12th, 2025

## Notes

Read rollout notes.

### Context

Ship behind a flag.`);
});

test("reads task page with hidden optional fields", async () => {
    const taskId = generateId<TaskId>();

    await storeAgentWebPageLinkForTest(storage, {
        type: "Task",
        id: taskId,
        title: "Bare task",
        status: {type: "Closed"},
    });

    mockGetTask(api, spaceId, taskId, {
        title: "Bare task",
        status: {type: "Closed"},
        collections: [],
        subtasks: {openTaskCount: 0, closedTaskCount: 0},
        notes: {version: 0, content: addKeysToApiContentForTest(emptyNotesContent)},
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/task/bare-task",
            limit: "10kb",
        }),
    ).toEqual(`\
# Bare task

- Status: Closed`);
});

test("reads task subtasks beneath notes and ignores task page URL filters and sorts", async () => {
    const taskId = generateId<TaskId>();
    const taskStatus = {type: "Open", isActive: false} as const;
    const firstSubtask = createApiTaskMock({
        index: 301,
        title: "First subtask",
        layout: "Project",
        parent: {id: taskId, title: "Task with subtasks", status: taskStatus},
    });
    const secondSubtask = createApiTaskMock({
        index: 302,
        title: "Second subtask",
        status: "Closed",
        parent: {id: taskId, title: "Task with subtasks", status: taskStatus},
    });

    await storeAgentWebPageLinkForTest(storage, {
        type: "Task",
        id: taskId,
        title: "Task with subtasks",
        status: taskStatus,
    });
    mockGetTask(
        api,
        spaceId,
        taskId,
        {
            title: "Task with subtasks",
            status: taskStatus,
            collections: [],
            subtasks: {openTaskCount: 1, closedTaskCount: 1},
            notes: {
                version: 1,
                content: addKeysToApiContentForTest({
                    elements: [
                        {
                            type: "Paragraph",
                            elements: [{type: "Text", text: "Parent notes."}],
                        },
                    ],
                }),
            },
        },
        [firstSubtask, secondSubtask],
    );

    const requestCountBeforeRead = api.getRequestHistory().length;
    const response = await callAgentWebReadTool(context, {
        path: "/task/task-with-subtasks?status=closed&sort=-priority",
        limit: "10kb",
    });
    const taskRequests = api
        .getRequestHistory()
        .slice(requestCountBeforeRead)
        .map(({method, path, params}) => ({method, path, params}));

    expect({response, taskRequests}).toEqual({
        response: `\
# Task with subtasks

- Status: Open

## Notes

Parent notes.

## Subtasks

- [First subtask (Open)](/task/first-subtask)

- [Second subtask (Closed)](/task/second-subtask)`,
        taskRequests: [
            {
                method: "GET",
                path: "/tasks/{id}-with-notes/subtasks",
                params: {path: {id: taskId}, query: {limit: 51}},
            },
        ],
    });
});

test("prints exactly 50 subtasks and a See more link when more remain", async () => {
    const taskId = generateId<TaskId>();
    const taskStatus = {type: "Open", isActive: false} as const;
    const subtasks = Array.from({length: 51}, (_, index) =>
        createApiTaskMock({
            index: index + 400,
            title: `Subtask ${index + 1}`,
            parent: {id: taskId, title: "Large parent task", status: taskStatus},
        }),
    );
    const remainingSubtasks = [
        subtasks[50]!,
        ...Array.from({length: 12}, (_, index) =>
            createApiTaskMock({
                index: index + 451,
                title: `Subtask ${index + 52}`,
                parent: {id: taskId, title: "Large parent task", status: taskStatus},
            }),
        ),
    ];
    const afterCursor = printApiTaskQueryCursorMock(49);
    const seeMoreCursorHash = await createAgentWebTaskQueryCursorHash(
        storage,
        `Task:${taskId}`,
        afterCursor,
    );
    await storage.taskQueryCursorByHash.put([`Task:${taskId}`, "abc"], afterCursor);

    await storeAgentWebPageLinkForTest(storage, {
        type: "Task",
        id: taskId,
        title: "Large parent task",
        status: taskStatus,
    });
    mockGetTask(
        api,
        spaceId,
        taskId,
        {
            title: "Large parent task",
            status: taskStatus,
            collections: [],
            subtasks: {openTaskCount: 63, closedTaskCount: 0},
            notes: {version: 0, content: addKeysToApiContentForTest(emptyNotesContent)},
        },
        subtasks,
    );
    api.mockGet("/tasks/{id}/subtasks", {
        params: {path: {id: taskId}, query: {limit: 31, cursor: afterCursor}},
        data: {
            spaceId,
            task: withoutNotes(
                createApiTaskMock({
                    id: taskId,
                    title: "Large parent task",
                    subtasks: {openTaskCount: 63},
                }),
            ),
            nextCursor: null,
            tasks: remainingSubtasks.map((task, index) => ({
                cursor: printApiTaskQueryCursorMock(index + 50),
                task: withoutNotes(task),
            })),
        },
    });

    const taskPageResponse = await callAgentWebReadTool(context, {
        path: "/task/large-parent-task",
        limit: "100kb",
    });
    const subtasksPageResponse = await callAgentWebReadTool(context, {
        path: "/task/large-parent-task/subtasks?after=abc",
        limit: "100kb",
    });

    expect({taskPageResponse, subtasksPageResponse}).toEqual({
        taskPageResponse: `\
# Large parent task

- Status: Open

## Subtasks

- [Subtask 1 (Open)](/task/subtask-1)\n
- [Subtask 2 (Open)](/task/subtask-2)\n
- [Subtask 3 (Open)](/task/subtask-3)\n
- [Subtask 4 (Open)](/task/subtask-4)\n
- [Subtask 5 (Open)](/task/subtask-5)\n
- [Subtask 6 (Open)](/task/subtask-6)\n
- [Subtask 7 (Open)](/task/subtask-7)\n
- [Subtask 8 (Open)](/task/subtask-8)\n
- [Subtask 9 (Open)](/task/subtask-9)\n
- [Subtask 10 (Open)](/task/subtask-10)\n
- [Subtask 11 (Open)](/task/subtask-11)\n
- [Subtask 12 (Open)](/task/subtask-12)\n
- [Subtask 13 (Open)](/task/subtask-13)\n
- [Subtask 14 (Open)](/task/subtask-14)\n
- [Subtask 15 (Open)](/task/subtask-15)\n
- [Subtask 16 (Open)](/task/subtask-16)\n
- [Subtask 17 (Open)](/task/subtask-17)\n
- [Subtask 18 (Open)](/task/subtask-18)\n
- [Subtask 19 (Open)](/task/subtask-19)\n
- [Subtask 20 (Open)](/task/subtask-20)\n
- [Subtask 21 (Open)](/task/subtask-21)\n
- [Subtask 22 (Open)](/task/subtask-22)\n
- [Subtask 23 (Open)](/task/subtask-23)\n
- [Subtask 24 (Open)](/task/subtask-24)\n
- [Subtask 25 (Open)](/task/subtask-25)\n
- [Subtask 26 (Open)](/task/subtask-26)\n
- [Subtask 27 (Open)](/task/subtask-27)\n
- [Subtask 28 (Open)](/task/subtask-28)\n
- [Subtask 29 (Open)](/task/subtask-29)\n
- [Subtask 30 (Open)](/task/subtask-30)\n
- [Subtask 31 (Open)](/task/subtask-31)\n
- [Subtask 32 (Open)](/task/subtask-32)\n
- [Subtask 33 (Open)](/task/subtask-33)\n
- [Subtask 34 (Open)](/task/subtask-34)\n
- [Subtask 35 (Open)](/task/subtask-35)\n
- [Subtask 36 (Open)](/task/subtask-36)\n
- [Subtask 37 (Open)](/task/subtask-37)\n
- [Subtask 38 (Open)](/task/subtask-38)\n
- [Subtask 39 (Open)](/task/subtask-39)\n
- [Subtask 40 (Open)](/task/subtask-40)\n
- [Subtask 41 (Open)](/task/subtask-41)\n
- [Subtask 42 (Open)](/task/subtask-42)\n
- [Subtask 43 (Open)](/task/subtask-43)\n
- [Subtask 44 (Open)](/task/subtask-44)\n
- [Subtask 45 (Open)](/task/subtask-45)\n
- [Subtask 46 (Open)](/task/subtask-46)\n
- [Subtask 47 (Open)](/task/subtask-47)\n
- [Subtask 48 (Open)](/task/subtask-48)\n
- [Subtask 49 (Open)](/task/subtask-49)\n
- [Subtask 50 (Open)](/task/subtask-50)

[See more (13 remaining) »](/task/large-parent-task/subtasks?after=${seeMoreCursorHash})`,
        subtasksPageResponse: `\
Subtasks for [Large parent task (Open)](/task/large-parent-task).

- [Subtask 51 (Open)](/task/subtask-51)\n
- [Subtask 52 (Open)](/task/subtask-52)\n
- [Subtask 53 (Open)](/task/subtask-53)\n
- [Subtask 54 (Open)](/task/subtask-54)\n
- [Subtask 55 (Open)](/task/subtask-55)\n
- [Subtask 56 (Open)](/task/subtask-56)\n
- [Subtask 57 (Open)](/task/subtask-57)\n
- [Subtask 58 (Open)](/task/subtask-58)\n
- [Subtask 59 (Open)](/task/subtask-59)\n
- [Subtask 60 (Open)](/task/subtask-60)\n
- [Subtask 61 (Open)](/task/subtask-61)\n
- [Subtask 62 (Open)](/task/subtask-62)\n
- [Subtask 63 (Open)](/task/subtask-63)

End of tasks.`,
    });
});

function withoutNotes(task: ApiTaskWithNotesResponse): ApiTaskResponse {
    const {notes: _notes, ...taskWithoutNotes} = task;
    return taskWithoutNotes;
}
