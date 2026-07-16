import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {
    createApiTaskIdMock,
    createApiTaskMock,
} from "~/server/agents/api/test_helpers/create_api_task_mock.js";
import {mockApiGetTask} from "~/server/agents/api/test_helpers/mock_api_get_task.js";
import {printApiTaskQueryCursorMock} from "~/server/agents/api/test_helpers/mock_api_get_task_collection_tasks.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {
    ApiTaskResponse,
    ApiTaskWithoutNotesResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const parentTask = createApiTaskMock({id: createApiTaskIdMock(100), title: "My Task"});
const subtasks = [
    createApiTaskMock({index: 0, title: "First subtask", parent: parentTask}),
    createApiTaskMock({index: 1, title: "Second subtask", parent: parentTask}),
    createApiTaskMock({index: 2, title: "Third subtask", parent: parentTask}),
];
const {span} = testTracer.startSpan("call_agent_web_update_tool_for_task_subtasks.test.ts");
const api = new ApiClientMock();
const storage = createAgentWebSessionStorageForTest(spaceId);

const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        type: "Account",
        id: generateId<AccountId>(),
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: {id: generateId<BotId>()},
        pathname: "/bot/chatgpt",
    },
};

function mockReadSubtasks(tasks: ReadonlyArray<ApiTaskResponse>): void {
    api.mockGet("/tasks/{id}/subtasks", {
        params: {path: {id: parentTask.id}, query: {limit: 31, cursor: undefined}},
        data: {
            spaceId,
            task: withoutNotes(parentTask),
            nextCursor: null,
            tasks: tasks.map((task, index) => ({
                cursor: printApiTaskQueryCursorMock(index),
                task: withoutNotes(task),
            })),
        },
    });
}

function withoutNotes(task: ApiTaskResponse): ApiTaskWithoutNotesResponse {
    return omitObject(task, ["notes"]);
}

beforeEach(async () => {
    await storage.deleteAll();
    await createAgentWebPageStoredLinkPathname(storage, context.botAccount);
    await createAgentWebPageStoredLinkPathname(storage, {
        type: "Task",
        id: parentTask.id,
        title: parentTask.title,
        status: parentTask.status,
    });
});

test("manually reorders task subtasks", async () => {
    mockReadSubtasks(subtasks);
    api.mockPatch("/tasks", {
        params: "Any",
        data: {
            spaceId,
            tasks: [subtasks[2]!],
            results: [
                {
                    type: "Update",
                    result: {type: "MoveInParent", cursor: printApiTaskQueryCursorMock(10)},
                },
            ],
        },
    });

    await callAgentWebReadTool(context, {path: "/task/my-task/subtasks", limit: "10kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task/my-task/subtasks",
            updates: [
                {
                    old: `\
- [First subtask (Open)](/task/first-subtask)

- [Second subtask (Open)](/task/second-subtask)

- [Third subtask (Open)](/task/third-subtask)`,
                    new: `\
- [Third subtask (Open)](/task/third-subtask)

- [First subtask (Open)](/task/first-subtask)

- [Second subtask (Open)](/task/second-subtask)`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    const request = api.getRequestHistory().find(request => request.path === "/tasks");
    expect(request?.body).toEqual({
        spaceId,
        patches: [
            {
                type: "Update",
                id: subtasks[2]!.id,
                patch: {type: "MoveInParent", position: {type: "Start"}},
            },
        ],
    });
});

test("adds a task to manually ordered subtasks", async () => {
    mockReadSubtasks(subtasks.slice(0, 2));
    const {task: addedTask} = mockApiGetTask(api, {
        spaceId,
        index: 3,
        title: "Added subtask",
    });
    await createAgentWebPageStoredLinkPathname(storage, {
        type: "Task",
        id: addedTask.id,
        title: addedTask.title,
        status: addedTask.status,
    });
    api.mockPatch("/tasks", {
        params: "Any",
        data: {
            spaceId,
            tasks: [
                createApiTaskMock({
                    id: addedTask.id,
                    title: addedTask.title,
                    parent: parentTask,
                }),
            ],
            results: [
                {type: "Update", result: {type: "SetParent"}},
                {
                    type: "Update",
                    result: {type: "MoveInParent", cursor: printApiTaskQueryCursorMock(10)},
                },
            ],
        },
    });

    await callAgentWebReadTool(context, {path: "/task/my-task/subtasks", limit: "10kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task/my-task/subtasks",
            updates: [
                {
                    old: "- [Second subtask (Open)](/task/second-subtask)",
                    new:
                        "- [Second subtask (Open)](/task/second-subtask)\n" +
                        "- [Added subtask (Open)](/task/added-subtask)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    const request = api.getRequestHistory().find(request => request.path === "/tasks");
    expect(request?.body).toEqual({
        spaceId,
        patches: [
            {
                type: "Update",
                id: addedTask.id,
                patch: {type: "SetParent", parent: {task: {id: parentTask.id}}},
            },
            {
                type: "Update",
                id: addedTask.id,
                patch: {type: "MoveInParent", position: {type: "End"}},
            },
        ],
    });
});

test("creates a task in the middle of manually ordered subtasks", async () => {
    mockReadSubtasks(subtasks.slice(0, 2));
    const createdTask = createApiTaskMock({
        index: 4,
        title: "New subtask",
        status: "Closed",
        parent: parentTask,
        priority: "High",
        due: "2027-07-12",
    });

    api.mockPatch("/tasks", {
        params: "Any",
        data: {
            spaceId,
            tasks: [withoutNotes(createdTask)],
            results: [
                {
                    type: "Create",
                    task: {id: createdTask.id},
                    results: [{type: "MoveInParent", cursor: printApiTaskQueryCursorMock(10)}],
                },
            ],
        },
    });

    await callAgentWebReadTool(context, {path: "/task/my-task/subtasks", limit: "10kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task/my-task/subtasks",
            updates: [
                {
                    old: "- [First subtask (Open)](/task/first-subtask)",
                    new: `\
- [First subtask (Open)](/task/first-subtask)

- New subtask (Closed)
  - Priority: High
  - Due date: July 12th, 2027`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(
        api
            .getRequestHistory()
            .filter(request => request.method === "PATCH" && request.path === "/tasks")
            .map(request => request.body),
    ).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Create",
                    task: {
                        title: "New subtask",
                        status: {type: "Closed"},
                        parent: {task: {id: parentTask.id}},
                        collections: [],
                        priority: {type: "High"},
                        due: {date: "2027-07-12"},
                    },
                    patches: [
                        {
                            type: "MoveInParent",
                            position: {
                                type: "Between",
                                afterCursor: printApiTaskQueryCursorMock(0),
                                beforeCursor: printApiTaskQueryCursorMock(1),
                            },
                        },
                    ],
                },
            ],
        },
    ]);
});

test("creates multiple tasks in their written order", async () => {
    mockReadSubtasks([]);
    const firstCreatedTask = createApiTaskMock({
        index: 5,
        title: "First new subtask",
        parent: parentTask,
    });
    const secondCreatedTask = createApiTaskMock({
        index: 6,
        title: "Second new subtask",
        parent: parentTask,
    });

    api.mockPatch("/tasks", {
        params: "Any",
        data: {
            spaceId,
            tasks: [withoutNotes(firstCreatedTask), withoutNotes(secondCreatedTask)],
            results: [
                {
                    type: "Create",
                    task: {id: firstCreatedTask.id},
                    results: [{type: "MoveInParent", cursor: printApiTaskQueryCursorMock(10)}],
                },
                {
                    type: "Create",
                    task: {id: secondCreatedTask.id},
                    results: [{type: "MoveInParent", cursor: printApiTaskQueryCursorMock(11)}],
                },
            ],
        },
    });

    await callAgentWebReadTool(context, {path: "/task/my-task/subtasks", limit: "10kb"});

    const result = await callAgentWebUpdateTool(context, {
        path: "/task/my-task/subtasks",
        updates: [
            {
                old: "End of tasks.",
                new: `\
- First new subtask (Open)

- Second new subtask (Open)

End of tasks.`,
                replaceAll: false,
            },
        ],
    });

    expect({
        result,
        requests: api
            .getRequestHistory()
            .filter(request => request.method === "PATCH" && request.path === "/tasks")
            .map(request => request.body),
    }).toEqual({
        result: "Update was successful.",
        requests: [
            {
                spaceId,
                patches: [
                    {
                        type: "Create",
                        task: {
                            title: "First new subtask",
                            status: {type: "Open", isActive: false},
                            parent: {task: {id: parentTask.id}},
                            collections: [],
                        },
                        patches: [{type: "MoveInParent", position: {type: "End"}}],
                    },
                    {
                        type: "Create",
                        task: {
                            title: "Second new subtask",
                            status: {type: "Open", isActive: false},
                            parent: {task: {id: parentTask.id}},
                            collections: [],
                        },
                        patches: [{type: "MoveInParent", position: {type: "End"}}],
                    },
                ],
            },
        ],
    });
});

test("updates and creates tasks in one request", async () => {
    mockReadSubtasks(subtasks.slice(0, 1));
    const updatedTask = {...subtasks[0]!, priority: {type: "High"} as const};
    const createdTask = createApiTaskMock({
        index: 7,
        title: "New subtask",
        parent: parentTask,
    });

    api.mockPatch("/tasks", {
        params: "Any",
        data: {
            spaceId,
            tasks: [withoutNotes(updatedTask), withoutNotes(createdTask)],
            results: [
                {type: "Update", result: {type: "SetPriority"}},
                {
                    type: "Create",
                    task: {id: createdTask.id},
                    results: [{type: "MoveInParent", cursor: printApiTaskQueryCursorMock(10)}],
                },
            ],
        },
    });

    await callAgentWebReadTool(context, {path: "/task/my-task/subtasks", limit: "10kb"});

    const result = await callAgentWebUpdateTool(context, {
        path: "/task/my-task/subtasks",
        updates: [
            {
                old: "- [First subtask (Open)](/task/first-subtask)",
                new: `\
- [First subtask (Open)](/task/first-subtask)
  - Priority: High

- New subtask (Open)`,
                replaceAll: false,
            },
        ],
    });

    expect({
        result,
        requests: api
            .getRequestHistory()
            .filter(request => request.method === "PATCH" && request.path === "/tasks")
            .map(request => request.body),
    }).toEqual({
        result: "Update was successful.",
        requests: [
            {
                spaceId,
                patches: [
                    {
                        type: "Update",
                        id: updatedTask.id,
                        patch: {type: "SetPriority", priority: {type: "High"}},
                    },
                    {
                        type: "Create",
                        task: {
                            title: "New subtask",
                            status: {type: "Open", isActive: false},
                            parent: {task: {id: parentTask.id}},
                            collections: [],
                        },
                        patches: [{type: "MoveInParent", position: {type: "End"}}],
                    },
                ],
            },
        ],
    });
});

test("removes a task from manually ordered subtasks", async () => {
    mockReadSubtasks(subtasks.slice(0, 2));
    api.mockPatch("/tasks", {
        params: "Any",
        data: {
            spaceId,
            tasks: [subtasks[0]!],
            results: [{type: "Update", result: {type: "SetParent"}}],
        },
    });

    await callAgentWebReadTool(context, {path: "/task/my-task/subtasks", limit: "10kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task/my-task/subtasks",
            updates: [
                {
                    old: "- [First subtask (Open)](/task/first-subtask)\n",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    const request = api.getRequestHistory().find(request => request.path === "/tasks");
    expect(request?.body).toEqual({
        spaceId,
        patches: [
            {
                type: "Update",
                id: subtasks[0]!.id,
                patch: {type: "SetParent", parent: null},
            },
        ],
    });
});
