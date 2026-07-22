import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {
    createApiTaskIdMock,
    createApiTaskMock,
} from "~/server/agents/api/test_helpers/create_api_task_mock.js";
import {mockApiGetTask} from "~/server/agents/api/test_helpers/mock_api_get_task.js";
import {
    mockGetApiTaskCollectionTasks,
    printApiTaskQueryCursorMock,
} from "~/server/agents/api/test_helpers/mock_api_get_task_collection_tasks.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {
    createAgentWebTaskQueryCursorHash,
    getAgentWebTaskQueryCursorForHashIfExists,
} from "~/server/agents/web/agent_web_task_query_cursor_hash.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {
    ApiTaskCollectionResponse,
    ApiTaskPatchResult,
    ApiTaskResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InternalError} from "~/shared/error/error.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
import {AccountId, BotId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();

const {span} = testTracer.startSpan("call_agent_web_update_tool_for_task_collection_new.test.ts");
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

beforeEach(async () => {
    await storage.deleteAll();
});

function getApiPatchTaskCollectionRequestHistory() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "PATCH" && request.path === "/task-collections/{id}")
        .map(({body}) => body);
}

function getApiPatchTasksRequestHistory() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "PATCH" && request.path === "/tasks")
        .map(({body}) => body);
}

function mockApiPatchTasks(response: {
    params: "Any";
    data: {
        spaceId: SpaceId;
        tasks: ReadonlyArray<{
            task: ApiTaskResponse;
            results: ReadonlyArray<ApiTaskPatchResult>;
        }>;
    };
}): void {
    api.mockPatch("/tasks", {
        params: response.params,
        data: {
            spaceId: response.data.spaceId,
            tasks: response.data.tasks.map(({task}) => task),
            results: response.data.tasks.flatMap(({results}) =>
                results.map(result => ({type: "Update" as const, result})),
            ),
        },
    });
}

function getApiGetTaskWithoutNotesRequestHistory() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "GET" && request.path === "/tasks/{id}")
        .map(({params}) => params);
}

test("updates the task collection name", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    api.mockPatch("/task-collections/{id}", {
        params: {path: {id: collection.id}},
        data: {spaceId, collection: {...collection, name: "Test Task Collection 2026"}},
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "# Test Task Collection",
                    new: "# Test Task Collection 2026",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTaskCollectionRequestHistory()).toEqual([
        {patches: [{type: "SetName", name: "Test Task Collection 2026"}]},
    ]);
});

test("updates the task collection color", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        color: "Red",
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    api.mockPatch("/task-collections/{id}", {
        params: {path: {id: collection.id}},
        data: {spaceId, collection: {...collection, color: "Blue"}},
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [{old: "Color: Red", new: "Color: Blue", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTaskCollectionRequestHistory()).toEqual([
        {patches: [{type: "SetColor", color: "Blue"}]},
    ]);
});

test("adds a task collection color", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    api.mockPatch("/task-collections/{id}", {
        params: {path: {id: collection.id}},
        data: {spaceId, collection: {...collection, color: "Green"}},
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "# Test Task Collection",
                    new: "# Test Task Collection\n\nColor: Green",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTaskCollectionRequestHistory()).toEqual([
        {patches: [{type: "SetColor", color: "Green"}]},
    ]);
});

test("removes the task collection color by removing the color line", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        color: "Red",
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    api.mockPatch("/task-collections/{id}", {
        params: {path: {id: collection.id}},
        data: {spaceId, collection: {...collection, color: undefined}},
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [{old: "\n\nColor: Red", new: "", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTaskCollectionRequestHistory()).toEqual([
        {patches: [{type: "SetColor", color: null}]},
    ]);
});

test("removes the task collection color with a none color", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        color: "Red",
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    api.mockPatch("/task-collections/{id}", {
        params: {path: {id: collection.id}},
        data: {spaceId, collection: {...collection, color: undefined}},
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [{old: "Color: Red", new: "Color: None", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTaskCollectionRequestHistory()).toEqual([
        {patches: [{type: "SetColor", color: null}]},
    ]);
});

test("updates the task collection name and color together", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        color: "Red",
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    api.mockPatch("/task-collections/{id}", {
        params: {path: {id: collection.id}},
        data: {
            spaceId,
            collection: {...collection, name: "Test Task Collection 2026", color: "Blue"},
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "# Test Task Collection",
                    new: "# Test Task Collection 2026",
                    replaceAll: false,
                },
                {old: "Color: Red", new: "Color: Blue", replaceAll: false},
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTaskCollectionRequestHistory()).toEqual([
        {
            patches: [
                {type: "SetName", name: "Test Task Collection 2026"},
                {type: "SetColor", color: "Blue"},
            ],
        },
    ]);
});

test("updates a task title in its link label", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const tasks = [task1, task2];

    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: {...task1, title: "Renamed task"},
                    results: [{type: "SetTitle"}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "[Test Task 0 (Open)](/task/test-task-0)",
                    new: "[Renamed task (Open)](/task/test-task-0)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task1.id,
                    patch: {type: "SetTitle", title: "Renamed task"},
                },
            ],
        },
    ]);
});

test("updates a 200 character task title without truncating it", async () => {
    const oldTitle = "a".repeat(200);
    const newTitle = "b".repeat(200);
    const taskPath = `/task/${"a".repeat(50)}`;
    const task1 = createApiTaskMock({index: 0, title: oldTitle});
    const task2 = createApiTaskMock({index: 1});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: {...task1, title: newTitle},
                    results: [{type: "SetTitle"}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: `[${oldTitle} (Open)](${taskPath})`,
                    new: `[${newTitle} (Open)](${taskPath})`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task1.id,
                    patch: {type: "SetTitle", title: newTitle},
                },
            ],
        },
    ]);
});

test("updates a task status in its link label", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: {...task2, status: {type: "Closed"}},
                    results: [{type: "SetStatus"}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "[Test Task 1 (Open)](/task/test-task-1)",
                    new: "[Test Task 1 (Closed)](/task/test-task-1)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {type: "SetStatus", status: {type: "Closed"}},
                },
            ],
        },
    ]);
});

test("sets an assigned open task as active", async () => {
    const alice = createApiAccountMock({name: "Alice"});
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1, assignee: alice});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: {...task2, status: {type: "Open", isActive: true}},
                    results: [{type: "SetStatus"}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "[Test Task 1 (Open)](/task/test-task-1)",
                    new: "[Test Task 1 (Open, active)](/task/test-task-1)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {
                        type: "SetStatus",
                        status: {type: "Open", isActive: true},
                    },
                },
            ],
        },
    ]);
});

test("sets an open task as active while assigning it", async () => {
    const alice = createApiAccountMock({name: "Alice"});
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: {
                        ...task2,
                        status: {type: "Open", isActive: true},
                        assignee: alice,
                    },
                    results: [{type: "SetAssignee"}, {type: "SetStatus"}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, [collection, alice]);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open, active)](/task/test-task-1)\n" +
                        "  - Assignee: [Alice](/human/alice)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toMatchObject([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {
                        type: "SetAssignee",
                        assignee: {id: alice.id},
                    },
                },
                {
                    type: "Update",
                    id: task2.id,
                    patch: {
                        type: "SetStatus",
                        status: {type: "Open", isActive: true},
                    },
                },
            ],
        },
    ]);
});

test("rejects setting an unassigned open task as active", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, collection);
    await createAgentWebPageStoredLinkPathname(storage, context.botAccount);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "[Test Task 1 (Open)](/task/test-task-1)",
                    new: "[Test Task 1 (Open, active)](/task/test-task-1)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("Can\u2019t set the task \u201CTest Task 1\u201D as active if there\u2019s no assignee. We don\u2019t " +
                "recommend setting a task as active unless you\u2019re about to work on the task or " +
                "you know someone else is currently working on the task. Try again and either " +
                "set the task as open but inactive (e.g. `(Open)`) or set an assignee " +
                "(e.g. `- Assignee: [ChatGPT](/bot/chatgpt)`)."),
    );
});

test("preserves active status when updating a task title in its link label", async () => {
    const alice = createApiAccountMock({name: "Alice"});
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({
        index: 1,
        status: "OpenActive",
        assignee: alice,
    });
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: {...task2, title: "Renamed spec task"},
                    results: [{type: "SetTitle"}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "[Test Task 1 (Open, active)](/task/test-task-1)",
                    new: "[Renamed spec task (Open, active)](/task/test-task-1)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {type: "SetTitle", title: "Renamed spec task"},
                },
            ],
        },
    ]);
});

test("sets an active task as inactive", async () => {
    const alice = createApiAccountMock({name: "Alice"});
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({
        index: 1,
        status: "OpenActive",
        assignee: alice,
    });
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: {...task2, status: {type: "Open", isActive: false}},
                    results: [{type: "SetStatus"}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "[Test Task 1 (Open, active)](/task/test-task-1)",
                    new: "[Test Task 1 (Open, inactive)](/task/test-task-1)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {
                        type: "SetStatus",
                        status: {type: "Open", isActive: false},
                    },
                },
            ],
        },
    ]);
});

test("rejects removing the assignee from an active task", async () => {
    const alice = createApiAccountMock({name: "Alice"});
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({
        index: 1,
        status: "OpenActive",
        assignee: alice,
    });
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "\n  - Assignee: [Alice](/human/alice)",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("Can\u2019t remove the assignee from the active task \u201CTest Task 1\u201D. An active task " +
                "implies someone is currently working on the task and so an assignee is required " +
                "so we know who that is. Try again but set the task as inactive first (e.g. " +
                "`(Open)`)."),
    );
});

test("changes the assignee of an active task", async () => {
    const alice = createApiAccountMock({name: "Alice"});
    const bob = createApiAccountMock({name: "Bob"});
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({
        index: 1,
        status: "OpenActive",
        assignee: alice,
    });
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: {...task2, assignee: bob},
                    results: [{type: "SetAssignee"}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, [collection, bob]);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "[Alice](/human/alice)",
                    new: "[Bob](/human/bob)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toMatchObject([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {
                        type: "SetAssignee",
                        assignee: {id: bob.id},
                    },
                },
            ],
        },
    ]);
});

test("sets an active task as inactive while removing its assignee", async () => {
    const alice = createApiAccountMock({name: "Alice"});
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({
        index: 1,
        status: "OpenActive",
        assignee: alice,
    });
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: {
                        ...task2,
                        status: {type: "Open", isActive: false},
                        assignee: undefined,
                    },
                    results: [{type: "SetAssignee"}, {type: "SetStatus"}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old:
                        "- [Test Task 1 (Open, active)](/task/test-task-1)\n" +
                        "  - Assignee: [Alice](/human/alice)",
                    new: "- [Test Task 1 (Open, inactive)](/task/test-task-1)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {type: "SetAssignee", assignee: null},
                },
                {
                    type: "Update",
                    id: task2.id,
                    patch: {
                        type: "SetStatus",
                        status: {type: "Open", isActive: false},
                    },
                },
            ],
        },
    ]);
});

test("reopens a task as inactive from its link label", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1, status: "Closed"});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: {...task2, status: {type: "Open", isActive: false}},
                    results: [{type: "SetStatus"}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "[Test Task 1 (Closed)](/task/test-task-1)",
                    new: "[Test Task 1 (Open)](/task/test-task-1)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {
                        type: "SetStatus",
                        status: {type: "Open", isActive: false},
                    },
                },
            ],
        },
    ]);
});

test("updates task fields", async () => {
    const alice = createApiAccountMock({name: "Alice"});
    const otherTask = createApiTaskMock({index: 2, title: "Other task"});
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });
    const otherCollection = {
        id: generateId<typeof collection.id>(),
        name: "Other collection",
        defaults: {filters: [], sorts: []},
    };

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: createApiTaskMock({
                        index: 0,
                        parent: otherTask,
                        assignee: alice,
                        collections: [otherCollection],
                        priority: "High",
                        due: "2027-07-12",
                    }),
                    results: [
                        {type: "SetParent"},
                        {type: "SetAssignee"},
                        {type: "SetDue"},
                        {type: "SetPriority"},
                        {type: "AddCollection"},
                    ],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, [otherTask, collection, otherCollection, alice]);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 0 (Open)](/task/test-task-0)",
                    new:
                        "- [Test Task 0 (Open)](/task/test-task-0)\n" +
                        "  - Parent: [Other task](/task/other-task)\n" +
                        "  - Assignee: [Alice](/human/alice)\n" +
                        "  - Collections: [Other collection](/task-collection/other-collection)\n" +
                        "  - Priority: High\n" +
                        "  - Due date: July 12, 2027",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toMatchObject([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task1.id,
                    patch: {type: "SetParent", parent: {task: {id: otherTask.id}}},
                },
                {
                    type: "Update",
                    id: task1.id,
                    patch: {
                        type: "SetAssignee",
                        assignee: {id: alice.id},
                    },
                },
                {
                    type: "Update",
                    id: task1.id,
                    patch: {type: "SetDue", due: {date: "2027-07-12"}},
                },
                {
                    type: "Update",
                    id: task1.id,
                    patch: {type: "SetPriority", priority: {type: "High"}},
                },
                {
                    type: "Update",
                    id: task1.id,
                    patch: {
                        type: "AddCollection",
                        item: {
                            collection: {
                                type: "TaskCollection",
                                id: otherCollection.id,
                                title: "Other collection",
                            },
                        },
                    },
                },
            ],
        },
    ]);
});

test("updates only a task parent while leaving its other fields unchanged", async () => {
    const alice = createApiAccountMock({name: "Alice"});
    const otherTask = createApiTaskMock({index: 2, title: "Other task"});
    const task1 = createApiTaskMock({index: 0});
    const otherCollectionId = generateId<TaskCollectionId>();
    const task2 = createApiTaskMock({
        index: 1,
        parent: otherTask,
        assignee: alice,
        collections: [otherCollectionId],
        priority: "High",
        due: "2027-07-12",
    });
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: {...task2, parent: {task: task1}},
                    results: [{type: "SetParent"}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "Parent: [Other task](/task/other-task)",
                    new: "Parent: [Test Task 0](/task/test-task-0)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {type: "SetParent", parent: {task: {id: task1.id}}},
                },
            ],
        },
    ]);
});

test("updates only a task assignee while leaving its other fields unchanged", async () => {
    const alice = createApiAccountMock({name: "Alice"});
    const bob = createApiAccountMock({name: "Bob"});
    const otherTask = createApiTaskMock({index: 2, title: "Other task"});
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({
        index: 1,
        parent: otherTask,
        assignee: alice,
        priority: "High",
        due: "2027-07-12",
    });
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: {...task2, assignee: bob},
                    results: [{type: "SetAssignee"}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, [collection, bob]);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "Assignee: [Alice](/human/alice)",
                    new: "Assignee: [Bob](/human/bob)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toMatchObject([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {
                        type: "SetAssignee",
                        assignee: {id: bob.id},
                    },
                },
            ],
        },
    ]);
});

test("updates only a task due date while leaving its other fields unchanged", async () => {
    const alice = createApiAccountMock({name: "Alice"});
    const otherTask = createApiTaskMock({index: 2, title: "Other task"});
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({
        index: 1,
        parent: otherTask,
        assignee: alice,
        priority: "High",
        due: "2027-07-12",
    });
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: {...task2, due: {date: "2027-07-14"}},
                    results: [{type: "SetDue"}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "Due date: July 12th, 2027",
                    new: "Due date: July 14th, 2027",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {type: "SetDue", due: {date: "2027-07-14"}},
                },
            ],
        },
    ]);
});

test("includes the task title when rejecting an invalid task due date", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({
        index: 1,
        title: "Invalid due date task",
        due: "2027-07-12",
    });
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "Due date: July 12th, 2027",
                    new: "Due date: sometime after launch",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("Unexpected task due date \u201Csometime after launch\u201D for task " +
                "\u201CInvalid due date task\u201D. Try again with a date like \u201CJuly 12, 2027\u201D (not " +
                "including the time, just the date)."),
    );
});

test("updates only a task priority while leaving its other fields unchanged", async () => {
    const alice = createApiAccountMock({name: "Alice"});
    const otherTask = createApiTaskMock({index: 2, title: "Other task"});
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({
        index: 1,
        parent: otherTask,
        assignee: alice,
        priority: "High",
        due: "2027-07-12",
    });
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: {...task2, priority: {type: "Low"}},
                    results: [{type: "SetPriority"}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [{old: "Priority: High", new: "Priority: Low", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {type: "SetPriority", priority: {type: "Low"}},
                },
            ],
        },
    ]);
});

test("updates only task collections while leaving its other fields unchanged", async () => {
    const alice = createApiAccountMock({name: "Alice"});
    const otherTask = createApiTaskMock({index: 2, title: "Other task"});
    const otherCollection = {
        id: generateId<TaskCollectionId>(),
        name: "Other collection",
        defaults: {filters: [], sorts: []},
    };
    const designCollection = {
        id: generateId<TaskCollectionId>(),
        name: "Design",
        defaults: {filters: [], sorts: []},
    };
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({
        index: 1,
        parent: otherTask,
        assignee: alice,
        collections: [otherCollection],
        priority: "High",
        due: "2027-07-12",
    });
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: createApiTaskMock({
                        index: 1,
                        parent: otherTask,
                        assignee: alice,
                        collections: [otherCollection, designCollection],
                        priority: "High",
                        due: "2027-07-12",
                    }),
                    results: [{type: "AddCollection"}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, [collection, designCollection]);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "Collections: [Other collection](/task-collection/other-collection)",
                    new:
                        "Collections: [Other collection](/task-collection/other-collection), " +
                        "[Design](/task-collection/design)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toMatchObject([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {
                        type: "AddCollection",
                        item: {
                            collection: {
                                type: "TaskCollection",
                                id: designCollection.id,
                                title: "Design",
                            },
                        },
                    },
                },
            ],
        },
    ]);
});

test("rejects updating the additional task collection count", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({
        index: 1,
        collections: [
            {name: "Engineering"},
            {name: "Design"},
            {name: "Product"},
            {name: "Planning"},
            {name: "Marketing"},
        ],
    });
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [{old: "and 2 more", new: "and 3 more", replaceAll: false}],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("Can\u2019t change a task\u2019s collections by updating \u201Cand 2 more\u201D to \u201Cand 3 more\u201D " +
                "since we don\u2019t know which underlying collections you\u2019re trying to add. Instead " +
                "call the `read` tool for the task \u201CTest Task 1\u201D which will give you the full " +
                "collection list for the task which you can update with the `update` tool."),
    );
});

test("rejects decreasing the additional task collection count", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({
        index: 1,
        collections: [
            {name: "Engineering"},
            {name: "Design"},
            {name: "Product"},
            {name: "Planning"},
            {name: "Marketing"},
            {name: "Support"},
        ],
    });
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [{old: "and 3 more", new: "and 2 more", replaceAll: false}],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("Can\u2019t change a task\u2019s collections by updating \u201Cand 3 more\u201D to \u201Cand 2 more\u201D " +
                "since we don\u2019t know which underlying collections you\u2019re trying to remove. Instead " +
                "call the `read` tool for the task \u201CTest Task 1\u201D which will give you the full " +
                "collection list for the task which you can update with the `update` tool."),
    );
});

test("rejects updating task subtask counts", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({
        index: 1,
        subtasks: {openTaskCount: 3, closedTaskCount: 4},
    });
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "Subtasks: 3 open, 4 closed",
                    new: "Subtasks: 2 open, 5 closed",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("Can\u2019t change the task \u201CTest Task 1\u201D\u2019s subtasks by updating " +
                "\u201CSubtasks: 3 open, 4 closed\u201D to \u201CSubtasks: 2 open, 5 closed\u201D since we don\u2019t " +
                "know which underlying subtasks you\u2019re trying to add, remove, open, or close. " +
                "Try again with an update that leaves the `Subtasks` field unchanged."),
    );
});

test("removes a task from a manually ordered collection", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [{task: task2, results: [{type: "RemoveCollection"}]}],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "\n\n- [Test Task 1 (Open)](/task/test-task-1)",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {type: "RemoveCollection", collectionId: collection.id},
                },
            ],
        },
    ]);
});

test("adds a task to an empty manually ordered collection at the end", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 0,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const {task: newTask} = mockApiGetTask(api, {spaceId, index: 0});
    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: newTask,
                    results: [
                        {type: "AddCollection"},
                        {type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(0)},
                    ],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, [collection, newTask]);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "End of tasks.",
                    new: "- [Test Task 0 (Open)](/task/test-task-0)\n\nEnd of tasks.",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: newTask.id,
                    patch: {
                        type: "AddCollection",
                        item: {collection: {id: collection.id}},
                    },
                },
                {
                    type: "Update",
                    id: newTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                },
            ],
        },
    ]);
});

test("creates a task in an empty manually ordered collection at the end", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 0,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const createdTask = createApiTaskMock({
        index: 20,
        title: "New task",
        status: "Closed",
        priority: "High",
        due: "2027-07-12",
    });

    api.mockPatch("/tasks", {
        params: "Any",
        data: {
            spaceId,
            tasks: [createdTask],
            results: [
                {
                    type: "Create",
                    task: {id: createdTask.id},
                    results: [
                        {
                            type: "MoveInCollection",
                            cursor: printApiTaskQueryCursorMock(20),
                        },
                    ],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "End of tasks.",
                    new: `\
- New task (Closed)
  - Priority: High
  - Due date: July 12th, 2027

End of tasks.`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Create",
                    task: {
                        title: "New task",
                        status: {type: "Closed"},
                        collections: [{collection: {id: collection.id}}],
                        priority: {type: "High"},
                        due: {date: "2027-07-12"},
                    },
                    patches: [
                        {
                            type: "MoveInCollection",
                            collectionId: collection.id,
                            position: {type: "End"},
                        },
                    ],
                },
            ],
        },
    ]);
});

test("adds a task at the end of a manually ordered collection", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const {task: newTask} = mockApiGetTask(api, {spaceId, index: 2});
    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: newTask,
                    results: [
                        {type: "AddCollection"},
                        {type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(2)},
                    ],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, [collection, newTask]);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 2 (Open)](/task/test-task-2)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toMatchObject([
        {
            patches: [
                {
                    type: "Update",
                    id: newTask.id,
                    patch: {
                        type: "AddCollection",
                        item: {
                            collection: {
                                id: collection.id,
                            },
                        },
                    },
                },
                {
                    type: "Update",
                    id: newTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                },
            ],
        },
    ]);
    expect(getApiGetTaskWithoutNotesRequestHistory()).toEqual([{path: {id: newTask.id}}]);
});

test("adds a task at the start of a manually ordered collection", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const {task: newTask} = mockApiGetTask(api, {spaceId, index: 2});
    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: newTask,
                    results: [
                        {type: "AddCollection"},
                        {type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(2)},
                    ],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, [collection, newTask]);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 0 (Open)](/task/test-task-0)",
                    new:
                        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
                        "- [Test Task 0 (Open)](/task/test-task-0)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toMatchObject([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: newTask.id,
                    patch: {
                        type: "AddCollection",
                        item: {
                            collection: {
                                id: collection.id,
                            },
                        },
                    },
                },
                {
                    type: "Update",
                    id: newTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "Start"},
                    },
                },
            ],
        },
    ]);
});

test("adds a task in the middle of a manually ordered collection", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 5,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const {task: newTask} = mockApiGetTask(api, {spaceId, index: 5});
    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: newTask,
                    results: [
                        {type: "AddCollection"},
                        {type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(5)},
                    ],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, [collection, newTask]);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 5 (Open)](/task/test-task-5)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: newTask.id,
                    patch: {
                        type: "AddCollection",
                        item: {
                            collection: {
                                id: collection.id,
                            },
                        },
                    },
                },
                {
                    type: "Update",
                    id: newTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: printApiTaskQueryCursorMock(1),
                            beforeCursor: printApiTaskQueryCursorMock(2),
                        },
                    },
                },
            ],
        },
    ]);
});

test("adds a task with its existing fields", async () => {
    const parentTask = createApiTaskMock({index: 3, title: "Parent task"});
    const alice = createApiAccountMock({name: "Alice"});
    const engineeringCollection = {
        id: generateId<TaskCollectionId>(),
        name: "Engineering",
        defaults: {filters: [], sorts: []},
    };
    const designCollection = {
        id: generateId<TaskCollectionId>(),
        name: "Design",
        defaults: {filters: [], sorts: []},
    };
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const {task: newTask} = mockApiGetTask(api, {
        spaceId,
        index: 2,
        status: "OpenActive",
        parent: parentTask,
        subtasks: {openTaskCount: 3, closedTaskCount: 4},
        assignee: alice,
        collections: [engineeringCollection, designCollection],
        priority: "High",
        due: "2027-07-12",
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: newTask,
                    results: [
                        {type: "AddCollection"},
                        {type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(2)},
                    ],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, [
        collection,
        newTask,
        parentTask,
        alice,
        engineeringCollection,
        designCollection,
    ]);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 2 (Open, active)](/task/test-task-2)\n" +
                        "  - Parent: [Parent task](/task/parent-task)\n" +
                        "  - Subtasks: 3 open, 4 closed\n" +
                        "  - Assignee: [Alice](/human/alice)\n" +
                        "  - Collections: [Engineering](/task-collection/engineering), [Design](/task-collection/design)\n" +
                        "  - Priority: High\n" +
                        "  - Due date: July 12th, 2027",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toMatchObject([
        {
            patches: [
                {
                    type: "Update",
                    id: newTask.id,
                    patch: {type: "AddCollection"},
                },
                {
                    type: "Update",
                    id: newTask.id,
                    patch: {type: "MoveInCollection"},
                },
            ],
        },
    ]);
});

test("rejects adding a task without its existing fields", async () => {
    const parentTask = createApiTaskMock({index: 3, title: "Parent task"});
    const alice = createApiAccountMock({name: "Alice"});
    const otherCollections = ["Engineering", "Design", "Product", "Planning", "Marketing"].map(
        name => ({
            id: generateId<TaskCollectionId>(),
            name,
            defaults: {filters: [], sorts: []},
        }),
    );
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const {task: newTask} = mockApiGetTask(api, {
        spaceId,
        index: 2,
        parent: parentTask,
        subtasks: {openTaskCount: 3, closedTaskCount: 4},
        assignee: alice,
        collections: otherCollections,
        priority: "High",
        due: "2027-07-12",
    });

    await storeAgentWebPageLinkForTest(storage, [
        collection,
        newTask,
        parentTask,
        alice,
        ...otherCollections,
    ]);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 2 (Open)](/task/test-task-2)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. You can\u2019t change the task \u201CTest Task 2\u201D\u2019s title or fields while adding it to task collection markdown. Add the task with its current title and fields, then call the `update` tool again if you want to change its title or fields. Try again with this exact markdown for the task: `- [Test Task 2 (Open)](/task/test-task-2)\\\\n  - Parent: [Parent task](/task/parent-task)\\\\n  - Subtasks: 3 open, 4 closed\\\\n  - Assignee: [Alice](/human/alice)\\\\n  - Collections: [Engineering](/task-collection/engineering), [Design](/task-collection/design), [Product](/task-collection/product), and 2 more\\\\n  - Priority: High\\\\n  - Due date: July 12th, 2027`",
    );
});

test("rejects changing a task link while adding the task", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const {task: newTask} = mockApiGetTask(api, {
        spaceId,
        index: 2,
        title: "New task",
        status: "Closed",
    });
    await storeAgentWebPageLinkForTest(storage, [collection, newTask]);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Renamed task (Open)](/task/new-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("You can\u2019t change the task \u201CRenamed task\u201D\u2019s title or fields while adding it " +
                "to task collection markdown. Add the task with its current title and fields, " +
                "then call the `update` tool again if you want to change its title or fields. " +
                "Try again with this exact markdown for the task: `- [New task " +
                "(Closed)](/task/new-task)`"),
    );
});

test("rejects moving a task while changing a nested field", async () => {
    const firstTask = createApiTaskMock({index: 0, priority: "High"});
    const secondTask = createApiTaskMock({index: 1});
    const tasks = [firstTask, secondTask];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old:
                        "- [Test Task 0 (Open)](/task/test-task-0)\n" +
                        "  - Priority: High\n\n" +
                        "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 0 (Open)](/task/test-task-0)\n" +
                        "  - Priority: Low",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("You can\u2019t move the task \u201CTest Task 0\u201D and change its title or fields in the " +
                "same `update` tool call. Try again with two separate `update` tool calls, one " +
                "to change the task\u2019s title/fields and another to move the task."),
    );
});

test("rejects moving a task while changing its link fields", async () => {
    const firstTask = createApiTaskMock({index: 0});
    const secondTask = createApiTaskMock({index: 1});
    const tasks = [firstTask, secondTask];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old:
                        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
                        "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Renamed task (Closed)](/task/test-task-0)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("You can\u2019t move the task \u201CTest Task 0\u201D and change its title or fields in the " +
                "same `update` tool call. Try again with two separate `update` tool calls, one " +
                "to change the task\u2019s title/fields and another to move the task."),
    );
});

test("updates a stable task while moving a different task", async () => {
    const firstTask = createApiTaskMock({index: 0});
    const secondTask = createApiTaskMock({index: 1});
    const thirdTask = createApiTaskMock({index: 2});
    const tasks = [firstTask, secondTask, thirdTask];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: {...secondTask, priority: {type: "High"}},
                    results: [{type: "SetPriority"}],
                },
                {
                    task: firstTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(3)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old:
                        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 2 (Open)](/task/test-task-2)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n" +
                        "  - Priority: High\n\n" +
                        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
                        "- [Test Task 0 (Open)](/task/test-task-0)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: secondTask.id,
                    patch: {type: "SetPriority", priority: {type: "High"}},
                },
                {
                    type: "Update",
                    id: firstTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                },
            ],
        },
    ]);
});

test("moves a task to the end of a manually ordered collection", async () => {
    const firstTask = createApiTaskMock({index: 0});
    const secondTask = createApiTaskMock({index: 1});
    const tasks = [firstTask, secondTask];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: firstTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(2)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old:
                        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
                        "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 0 (Open)](/task/test-task-0)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: firstTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                },
            ],
        },
    ]);
});

test("moves a task to the end of a manually ordered collection with many tasks", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 5,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: createApiTaskMock({index: 0}),
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(5)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 0 (Open)](/task/test-task-0)\n\n",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Test Task 4 (Open)](/task/test-task-4)\n\n",
                    new:
                        "- [Test Task 4 (Open)](/task/test-task-4)\n\n" +
                        "- [Test Task 0 (Open)](/task/test-task-0)\n\n",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: createApiTaskIdMock(0),
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                },
            ],
        },
    ]);
});

test("moves a task to the start of a manually ordered collection with many tasks", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 5,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: createApiTaskMock({index: 4}),
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(5)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 4 (Open)](/task/test-task-4)\n\n",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Test Task 0 (Open)](/task/test-task-0)\n\n",
                    new: "- [Test Task 4 (Open)](/task/test-task-4)\n\n- [Test Task 0 (Open)](/task/test-task-0)\n\n",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: createApiTaskIdMock(4),
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "Start"},
                    },
                },
            ],
        },
    ]);
});

test("moves the last task near the middle of a large manually ordered collection", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 20,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const movedTask = createApiTaskMock({index: 19});

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: movedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(20)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "\n\n- [Test Task 19 (Open)](/task/test-task-19)",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Test Task 9 (Open)](/task/test-task-9)",
                    new:
                        "- [Test Task 9 (Open)](/task/test-task-9)\n\n" +
                        "- [Test Task 19 (Open)](/task/test-task-19)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: movedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: printApiTaskQueryCursorMock(9),
                            beforeCursor: printApiTaskQueryCursorMock(10),
                        },
                    },
                },
            ],
        },
    ]);
});

test("moves a task from the bottom fourth to the top fourth of a large collection", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 20,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const movedTask = createApiTaskMock({index: 16});

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: movedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(20)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 16 (Open)](/task/test-task-16)\n\n",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Test Task 3 (Open)](/task/test-task-3)",
                    new:
                        "- [Test Task 3 (Open)](/task/test-task-3)\n\n" +
                        "- [Test Task 16 (Open)](/task/test-task-16)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: movedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: printApiTaskQueryCursorMock(3),
                            beforeCursor: printApiTaskQueryCursorMock(4),
                        },
                    },
                },
            ],
        },
    ]);
});

test("moves a task from the top fourth to the bottom fourth of a large collection", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 20,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const movedTask = createApiTaskMock({index: 3});

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: movedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(20)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 3 (Open)](/task/test-task-3)\n\n",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Test Task 15 (Open)](/task/test-task-15)",
                    new:
                        "- [Test Task 15 (Open)](/task/test-task-15)\n\n" +
                        "- [Test Task 3 (Open)](/task/test-task-3)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: movedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: printApiTaskQueryCursorMock(15),
                            beforeCursor: printApiTaskQueryCursorMock(16),
                        },
                    },
                },
            ],
        },
    ]);
});

test("moves a task to the start of a manually ordered tail page", async () => {
    const afterCursor = printApiTaskQueryCursorMock(0);
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 4,
        limit: 31,
        cursor: afterCursor,
        createTask: index => createApiTaskMock({index}),
    });
    const movedTask = createApiTaskMock({index: 3});
    const afterCursorHash = await createAgentWebTaskQueryCursorHash(
        storage,
        `TaskCollection:${collection.id}`,
        afterCursor,
    );
    const path = `/task-collection/test-task-collection?after=${afterCursorHash}`;

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: movedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(4)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {path, limit: "50kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
                        "- [Test Task 3 (Open)](/task/test-task-3)",
                    new:
                        "- [Test Task 3 (Open)](/task/test-task-3)\n\n" +
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 2 (Open)](/task/test-task-2)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: movedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor,
                            beforeCursor: printApiTaskQueryCursorMock(1),
                        },
                    },
                },
            ],
        },
    ]);
});

test("moves a task to the end of a manually ordered tail page", async () => {
    const afterCursor = printApiTaskQueryCursorMock(0);
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 3,
        limit: 31,
        cursor: afterCursor,
        createTask: index => createApiTaskMock({index}),
    });
    const movedTask = createApiTaskMock({index: 1});
    const afterCursorHash = await createAgentWebTaskQueryCursorHash(
        storage,
        `TaskCollection:${collection.id}`,
        afterCursor,
    );
    const path = `/task-collection/test-task-collection?after=${afterCursorHash}`;

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: movedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(3)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {path, limit: "50kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 2 (Open)](/task/test-task-2)",
                    new:
                        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
                        "- [Test Task 1 (Open)](/task/test-task-1)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: movedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                },
            ],
        },
    ]);
});

test("moves a task past four other tasks to the end of a manually ordered tail page", async () => {
    const afterCursor = printApiTaskQueryCursorMock(0);
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 6,
        limit: 31,
        cursor: afterCursor,
        createTask: index => createApiTaskMock({index}),
    });
    const movedTask = createApiTaskMock({index: 1});
    const afterCursorHash = await createAgentWebTaskQueryCursorHash(
        storage,
        `TaskCollection:${collection.id}`,
        afterCursor,
    );
    const path = `/task-collection/test-task-collection?after=${afterCursorHash}`;

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: movedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(6)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {path, limit: "50kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)\n\n",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Test Task 5 (Open)](/task/test-task-5)",
                    new:
                        "- [Test Task 5 (Open)](/task/test-task-5)\n\n" +
                        "- [Test Task 1 (Open)](/task/test-task-1)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: movedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                },
            ],
        },
    ]);
});

test("moves a task into the middle of a manually ordered tail page", async () => {
    const afterCursor = printApiTaskQueryCursorMock(4);
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 10,
        limit: 31,
        cursor: afterCursor,
        createTask: index => createApiTaskMock({index}),
    });
    const movedTask = createApiTaskMock({index: 9});
    const afterCursorHash = await createAgentWebTaskQueryCursorHash(
        storage,
        `TaskCollection:${collection.id}`,
        afterCursor,
    );
    const path = `/task-collection/test-task-collection?after=${afterCursorHash}`;

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: movedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(10)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {path, limit: "50kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "\n\n- [Test Task 9 (Open)](/task/test-task-9)",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Test Task 6 (Open)](/task/test-task-6)",
                    new:
                        "- [Test Task 6 (Open)](/task/test-task-6)\n\n" +
                        "- [Test Task 9 (Open)](/task/test-task-9)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: movedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: printApiTaskQueryCursorMock(6),
                            beforeCursor: printApiTaskQueryCursorMock(7),
                        },
                    },
                },
            ],
        },
    ]);
});

test("moves a task to the end of a manually ordered tail page with a next page", async () => {
    const afterCursor = printApiTaskQueryCursorMock(9);
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 42,
        limit: 31,
        cursor: afterCursor,
        createTask: index => createApiTaskMock({index}),
    });
    const movedTask = createApiTaskMock({index: 10});
    const afterCursorHash = await createAgentWebTaskQueryCursorHash(
        storage,
        `TaskCollection:${collection.id}`,
        afterCursor,
    );
    const path = `/task-collection/test-task-collection?after=${afterCursorHash}`;

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: movedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(42)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    const response = await callAgentWebReadTool(context, {path, limit: "1446b"});

    const updateResponse = await callAgentWebUpdateTool(context, {
        path,
        updates: [
            {
                old: "- [Test Task 10 (Open)](/task/test-task-10)\n\n",
                new: "",
                replaceAll: false,
            },
            {
                old: "- [Test Task 39 (Open)](/task/test-task-39)",
                new:
                    "- [Test Task 39 (Open)](/task/test-task-39)\n\n" +
                    "- [Test Task 10 (Open)](/task/test-task-10)",
                replaceAll: false,
            },
        ],
    });

    expect({
        responseLength: response.length,
        hasNextPageLink: response.includes("[Next page »]"),
        updateResponse,
        patchRequests: getApiPatchTasksRequestHistory(),
    }).toEqual({
        responseLength: 1446,
        hasNextPageLink: true,
        updateResponse: "Update was successful.",
        patchRequests: [
            {
                spaceId,
                patches: [
                    {
                        type: "Update",
                        id: movedTask.id,
                        patch: {
                            type: "MoveInCollection",
                            collectionId: collection.id,
                            position: {
                                type: "Between",
                                afterCursor: printApiTaskQueryCursorMock(39),
                                beforeCursor: printApiTaskQueryCursorMock(40),
                            },
                        },
                    },
                ],
            },
        ],
    });
});

test("moves a task to the end of a truncated manually ordered page", async () => {
    const firstTask = createApiTaskMock({index: 0});
    const secondTask = createApiTaskMock({index: 1});
    const hiddenTask = createApiTaskMock({index: 2, title: "X".repeat(160)});
    const tasks = [firstTask, secondTask, hiddenTask];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: firstTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(3)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    const response = await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "230b",
    });

    expect({
        includesSecondTask: response.includes("- [Test Task 1 (Open)](/task/test-task-1)"),
        includesHiddenTask: response.includes("X".repeat(160)),
    }).toEqual({includesSecondTask: true, includesHiddenTask: false});

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old:
                        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
                        "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 0 (Open)](/task/test-task-0)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: firstTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: printApiTaskQueryCursorMock(1),
                            beforeCursor: printApiTaskQueryCursorMock(2),
                        },
                    },
                },
            ],
        },
    ]);
});

test("moves a task past five other tasks to the end of a truncated page", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 10,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const movedTask = createApiTaskMock({index: 0});

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: movedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(10)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    const response = await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "400b",
    });

    const updateResponse = await callAgentWebUpdateTool(context, {
        path: "/task-collection/test-task-collection",
        updates: [
            {
                old: "- [Test Task 0 (Open)](/task/test-task-0)\n\n",
                new: "",
                replaceAll: false,
            },
            {
                old: "- [Test Task 5 (Open)](/task/test-task-5)",
                new:
                    "- [Test Task 5 (Open)](/task/test-task-5)\n\n" +
                    "- [Test Task 0 (Open)](/task/test-task-0)",
                replaceAll: false,
            },
        ],
    });

    expect({
        includesLastVisibleTask: response.includes("- [Test Task 5 (Open)](/task/test-task-5)"),
        includesFirstHiddenTask: response.includes("- [Test Task 6 (Open)](/task/test-task-6)"),
        hasNextPageLink: response.includes("[Next page »]"),
        updateResponse,
        patchRequests: getApiPatchTasksRequestHistory(),
    }).toEqual({
        includesLastVisibleTask: true,
        includesFirstHiddenTask: false,
        hasNextPageLink: true,
        updateResponse: "Update was successful.",
        patchRequests: [
            {
                spaceId,
                patches: [
                    {
                        type: "Update",
                        id: movedTask.id,
                        patch: {
                            type: "MoveInCollection",
                            collectionId: collection.id,
                            position: {
                                type: "Between",
                                afterCursor: printApiTaskQueryCursorMock(5),
                                beforeCursor: printApiTaskQueryCursorMock(6),
                            },
                        },
                    },
                ],
            },
        ],
    });
});

test("moves a task past five other tasks to the end of a truncated tail page", async () => {
    const afterCursor = printApiTaskQueryCursorMock(4);
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 15,
        limit: 31,
        cursor: afterCursor,
        createTask: index => createApiTaskMock({index}),
    });
    const movedTask = createApiTaskMock({index: 5});
    const afterCursorHash = await createAgentWebTaskQueryCursorHash(
        storage,
        `TaskCollection:${collection.id}`,
        afterCursor,
    );
    const path = `/task-collection/test-task-collection?after=${afterCursorHash}`;

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: movedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(15)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    const response = await callAgentWebReadTool(context, {path, limit: "400b"});

    const updateResponse = await callAgentWebUpdateTool(context, {
        path,
        updates: [
            {
                old: "- [Test Task 5 (Open)](/task/test-task-5)\n\n",
                new: "",
                replaceAll: false,
            },
            {
                old: "- [Test Task 10 (Open)](/task/test-task-10)",
                new:
                    "- [Test Task 10 (Open)](/task/test-task-10)\n\n" +
                    "- [Test Task 5 (Open)](/task/test-task-5)",
                replaceAll: false,
            },
        ],
    });

    expect({
        includesLastVisibleTask: response.includes("- [Test Task 10 (Open)](/task/test-task-10)"),
        includesFirstHiddenTask: response.includes("- [Test Task 11 (Open)](/task/test-task-11)"),
        hasNextPageLink: response.includes("[Next page »]"),
        updateResponse,
        patchRequests: getApiPatchTasksRequestHistory(),
    }).toEqual({
        includesLastVisibleTask: true,
        includesFirstHiddenTask: false,
        hasNextPageLink: true,
        updateResponse: "Update was successful.",
        patchRequests: [
            {
                spaceId,
                patches: [
                    {
                        type: "Update",
                        id: movedTask.id,
                        patch: {
                            type: "MoveInCollection",
                            collectionId: collection.id,
                            position: {
                                type: "Between",
                                afterCursor: printApiTaskQueryCursorMock(10),
                                beforeCursor: printApiTaskQueryCursorMock(11),
                            },
                        },
                    },
                ],
            },
        ],
    });
});

test("moves a task to the end of a page that exactly meets the read limit", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 32,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const movedTask = createApiTaskMock({index: 0});

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: movedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(32)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    const response = await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "1419b",
    });

    const updateResponse = await callAgentWebUpdateTool(context, {
        path: "/task-collection/test-task-collection",
        updates: [
            {
                old: "- [Test Task 0 (Open)](/task/test-task-0)\n\n",
                new: "",
                replaceAll: false,
            },
            {
                old: "- [Test Task 29 (Open)](/task/test-task-29)",
                new:
                    "- [Test Task 29 (Open)](/task/test-task-29)\n\n" +
                    "- [Test Task 0 (Open)](/task/test-task-0)",
                replaceAll: false,
            },
        ],
    });

    expect({
        responseLength: response.length,
        hasNextPageLink: response.includes("[Next page »]"),
        includesInvisibleTask: response.includes("- [Test Task 30 (Open)](/task/test-task-30)"),
        updateResponse,
        patchRequests: getApiPatchTasksRequestHistory(),
    }).toEqual({
        responseLength: 1419,
        hasNextPageLink: true,
        includesInvisibleTask: false,
        updateResponse: "Update was successful.",
        patchRequests: [
            {
                spaceId,
                patches: [
                    {
                        type: "Update",
                        id: movedTask.id,
                        patch: {
                            type: "MoveInCollection",
                            collectionId: collection.id,
                            position: {
                                type: "Between",
                                afterCursor: printApiTaskQueryCursorMock(29),
                                beforeCursor: printApiTaskQueryCursorMock(30),
                            },
                        },
                    },
                ],
            },
        ],
    });
});

test("moves a task to the end after loading and truncating more than thirty tasks", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 62,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collection.id,
        totalTaskCount: 62,
        limit: 31,
        cursor: printApiTaskQueryCursorMock(30),
        createTask: index => createApiTaskMock({index}),
    });
    const movedTask = createApiTaskMock({index: 0});

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: movedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(62)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    const response = await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "2500b",
    });

    const updateResponse = await callAgentWebUpdateTool(context, {
        path: "/task-collection/test-task-collection",
        updates: [
            {
                old: "- [Test Task 0 (Open)](/task/test-task-0)\n\n",
                new: "",
                replaceAll: false,
            },
            {
                old: "- [Test Task 52 (Open)](/task/test-task-52)",
                new:
                    "- [Test Task 52 (Open)](/task/test-task-52)\n\n" +
                    "- [Test Task 0 (Open)](/task/test-task-0)",
                replaceAll: false,
            },
        ],
    });

    expect({
        collectionTaskGetCount: api
            .getRequestHistory()
            .filter(
                request =>
                    request.method === "GET" && request.path === "/task-collections/{id}/tasks",
            ).length,
        includesLastVisibleTask: response.includes("- [Test Task 52 (Open)](/task/test-task-52)"),
        includesFirstHiddenTask: response.includes("- [Test Task 53 (Open)](/task/test-task-53)"),
        hasNextPageLink: response.includes("[Next page »]"),
        updateResponse,
        patchRequests: getApiPatchTasksRequestHistory(),
    }).toEqual({
        collectionTaskGetCount: 2,
        includesLastVisibleTask: true,
        includesFirstHiddenTask: false,
        hasNextPageLink: true,
        updateResponse: "Update was successful.",
        patchRequests: [
            {
                spaceId,
                patches: [
                    {
                        type: "Update",
                        id: movedTask.id,
                        patch: {
                            type: "MoveInCollection",
                            collectionId: collection.id,
                            position: {
                                type: "Between",
                                afterCursor: printApiTaskQueryCursorMock(52),
                                beforeCursor: printApiTaskQueryCursorMock(53),
                            },
                        },
                    },
                ],
            },
        ],
    });
});

test("atomically moves tasks with the same position in page order", async () => {
    const tasks = [
        createApiTaskMock({index: 0}),
        createApiTaskMock({index: 1}),
        createApiTaskMock({index: 2}),
        createApiTaskMock({index: 3}),
    ];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: tasks[0]!,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(4)}],
                },
                {
                    task: tasks[1]!,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(5)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old:
                        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
                        "- [Test Task 3 (Open)](/task/test-task-3)",
                    new:
                        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
                        "- [Test Task 3 (Open)](/task/test-task-3)\n\n" +
                        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
                        "- [Test Task 1 (Open)](/task/test-task-1)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect({
        batchRequestBodies: getApiPatchTasksRequestHistory(),
        individualRequestCount: api
            .getRequestHistory()
            .filter(request => request.path === "/tasks/{id}").length,
    }).toEqual({
        batchRequestBodies: [
            {
                spaceId,
                patches: [
                    {
                        type: "Update",
                        id: tasks[0]!.id,
                        patch: {
                            type: "MoveInCollection",
                            collectionId: collection.id,
                            position: {type: "End"},
                        },
                    },
                    {
                        type: "Update",
                        id: tasks[1]!.id,
                        patch: {
                            type: "MoveInCollection",
                            collectionId: collection.id,
                            position: {type: "End"},
                        },
                    },
                ],
            },
        ],
        individualRequestCount: 0,
    });
});

test("atomically moves multiple tasks into the middle in page order", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 10,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const firstMovedTask = createApiTaskMock({index: 7});
    const secondMovedTask = createApiTaskMock({index: 8});

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: firstMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(10)}],
                },
                {
                    task: secondMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(11)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 7 (Open)](/task/test-task-7)\n\n",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Test Task 8 (Open)](/task/test-task-8)\n\n",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Test Task 2 (Open)](/task/test-task-2)",
                    new:
                        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
                        "- [Test Task 7 (Open)](/task/test-task-7)\n\n" +
                        "- [Test Task 8 (Open)](/task/test-task-8)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    const position = {
        type: "Between",
        afterCursor: printApiTaskQueryCursorMock(2),
        beforeCursor: printApiTaskQueryCursorMock(3),
    };

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: firstMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position,
                    },
                },
                {
                    type: "Update",
                    id: secondMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position,
                    },
                },
            ],
        },
    ]);
});

test("atomically moves multiple tasks to the start in page order", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 8,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const firstMovedTask = createApiTaskMock({index: 6});
    const secondMovedTask = createApiTaskMock({index: 7});

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: firstMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(8)}],
                },
                {
                    task: secondMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(9)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old:
                        "\n\n- [Test Task 6 (Open)](/task/test-task-6)\n\n" +
                        "- [Test Task 7 (Open)](/task/test-task-7)",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Test Task 0 (Open)](/task/test-task-0)",
                    new:
                        "- [Test Task 6 (Open)](/task/test-task-6)\n\n" +
                        "- [Test Task 7 (Open)](/task/test-task-7)\n\n" +
                        "- [Test Task 0 (Open)](/task/test-task-0)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: firstMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "Start"},
                    },
                },
                {
                    type: "Update",
                    id: secondMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "Start"},
                    },
                },
            ],
        },
    ]);
});

test("atomically swaps two tasks at distant locations", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 10,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const firstMovedTask = createApiTaskMock({index: 8});
    const secondMovedTask = createApiTaskMock({index: 1});

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: firstMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(10)}],
                },
                {
                    task: secondMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(11)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    const oldTaskList =
        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
        "- [Test Task 3 (Open)](/task/test-task-3)\n\n" +
        "- [Test Task 4 (Open)](/task/test-task-4)\n\n" +
        "- [Test Task 5 (Open)](/task/test-task-5)\n\n" +
        "- [Test Task 6 (Open)](/task/test-task-6)\n\n" +
        "- [Test Task 7 (Open)](/task/test-task-7)\n\n" +
        "- [Test Task 8 (Open)](/task/test-task-8)\n\n" +
        "- [Test Task 9 (Open)](/task/test-task-9)";
    const newTaskList =
        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
        "- [Test Task 8 (Open)](/task/test-task-8)\n\n" +
        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
        "- [Test Task 3 (Open)](/task/test-task-3)\n\n" +
        "- [Test Task 4 (Open)](/task/test-task-4)\n\n" +
        "- [Test Task 5 (Open)](/task/test-task-5)\n\n" +
        "- [Test Task 6 (Open)](/task/test-task-6)\n\n" +
        "- [Test Task 7 (Open)](/task/test-task-7)\n\n" +
        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
        "- [Test Task 9 (Open)](/task/test-task-9)";

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [{old: oldTaskList, new: newTaskList, replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: firstMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: printApiTaskQueryCursorMock(0),
                            beforeCursor: printApiTaskQueryCursorMock(2),
                        },
                    },
                },
                {
                    type: "Update",
                    id: secondMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: printApiTaskQueryCursorMock(7),
                            beforeCursor: printApiTaskQueryCursorMock(9),
                        },
                    },
                },
            ],
        },
    ]);
});

test("atomically moves two tasks to different locations", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 10,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const firstMovedTask = createApiTaskMock({index: 8});
    const secondMovedTask = createApiTaskMock({index: 1});

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: firstMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(10)}],
                },
                {
                    task: secondMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(11)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    const oldTaskList =
        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
        "- [Test Task 3 (Open)](/task/test-task-3)\n\n" +
        "- [Test Task 4 (Open)](/task/test-task-4)\n\n" +
        "- [Test Task 5 (Open)](/task/test-task-5)\n\n" +
        "- [Test Task 6 (Open)](/task/test-task-6)\n\n" +
        "- [Test Task 7 (Open)](/task/test-task-7)\n\n" +
        "- [Test Task 8 (Open)](/task/test-task-8)\n\n" +
        "- [Test Task 9 (Open)](/task/test-task-9)";
    const newTaskList =
        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
        "- [Test Task 3 (Open)](/task/test-task-3)\n\n" +
        "- [Test Task 8 (Open)](/task/test-task-8)\n\n" +
        "- [Test Task 4 (Open)](/task/test-task-4)\n\n" +
        "- [Test Task 5 (Open)](/task/test-task-5)\n\n" +
        "- [Test Task 6 (Open)](/task/test-task-6)\n\n" +
        "- [Test Task 7 (Open)](/task/test-task-7)\n\n" +
        "- [Test Task 9 (Open)](/task/test-task-9)\n\n" +
        "- [Test Task 1 (Open)](/task/test-task-1)";

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [{old: oldTaskList, new: newTaskList, replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: firstMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: printApiTaskQueryCursorMock(3),
                            beforeCursor: printApiTaskQueryCursorMock(4),
                        },
                    },
                },
                {
                    type: "Update",
                    id: secondMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                },
            ],
        },
    ]);
});

test("atomically moves three tasks to different locations", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 12,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const firstMovedTask = createApiTaskMock({index: 10});
    const secondMovedTask = createApiTaskMock({index: 1});
    const thirdMovedTask = createApiTaskMock({index: 5});

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: firstMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(12)}],
                },
                {
                    task: secondMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(13)}],
                },
                {
                    task: thirdMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(14)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    const oldTaskList =
        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
        "- [Test Task 3 (Open)](/task/test-task-3)\n\n" +
        "- [Test Task 4 (Open)](/task/test-task-4)\n\n" +
        "- [Test Task 5 (Open)](/task/test-task-5)\n\n" +
        "- [Test Task 6 (Open)](/task/test-task-6)\n\n" +
        "- [Test Task 7 (Open)](/task/test-task-7)\n\n" +
        "- [Test Task 8 (Open)](/task/test-task-8)\n\n" +
        "- [Test Task 9 (Open)](/task/test-task-9)\n\n" +
        "- [Test Task 10 (Open)](/task/test-task-10)\n\n" +
        "- [Test Task 11 (Open)](/task/test-task-11)";
    const newTaskList =
        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
        "- [Test Task 10 (Open)](/task/test-task-10)\n\n" +
        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
        "- [Test Task 3 (Open)](/task/test-task-3)\n\n" +
        "- [Test Task 4 (Open)](/task/test-task-4)\n\n" +
        "- [Test Task 6 (Open)](/task/test-task-6)\n\n" +
        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
        "- [Test Task 7 (Open)](/task/test-task-7)\n\n" +
        "- [Test Task 8 (Open)](/task/test-task-8)\n\n" +
        "- [Test Task 9 (Open)](/task/test-task-9)\n\n" +
        "- [Test Task 11 (Open)](/task/test-task-11)\n\n" +
        "- [Test Task 5 (Open)](/task/test-task-5)";

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [{old: oldTaskList, new: newTaskList, replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: firstMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: printApiTaskQueryCursorMock(0),
                            beforeCursor: printApiTaskQueryCursorMock(2),
                        },
                    },
                },
                {
                    type: "Update",
                    id: secondMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: printApiTaskQueryCursorMock(6),
                            beforeCursor: printApiTaskQueryCursorMock(7),
                        },
                    },
                },
                {
                    type: "Update",
                    id: thirdMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                },
            ],
        },
    ]);
});

test("atomically moves five tasks to different locations", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 13,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });
    const firstMovedTask = createApiTaskMock({index: 9});
    const secondMovedTask = createApiTaskMock({index: 7});
    const thirdMovedTask = createApiTaskMock({index: 1});
    const fourthMovedTask = createApiTaskMock({index: 5});
    const fifthMovedTask = createApiTaskMock({index: 3});

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: firstMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(13)}],
                },
                {
                    task: secondMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(14)}],
                },
                {
                    task: thirdMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(15)}],
                },
                {
                    task: fourthMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(16)}],
                },
                {
                    task: fifthMovedTask,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(17)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    const oldTaskList =
        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
        "- [Test Task 3 (Open)](/task/test-task-3)\n\n" +
        "- [Test Task 4 (Open)](/task/test-task-4)\n\n" +
        "- [Test Task 5 (Open)](/task/test-task-5)\n\n" +
        "- [Test Task 6 (Open)](/task/test-task-6)\n\n" +
        "- [Test Task 7 (Open)](/task/test-task-7)\n\n" +
        "- [Test Task 8 (Open)](/task/test-task-8)\n\n" +
        "- [Test Task 9 (Open)](/task/test-task-9)\n\n" +
        "- [Test Task 10 (Open)](/task/test-task-10)\n\n" +
        "- [Test Task 11 (Open)](/task/test-task-11)\n\n" +
        "- [Test Task 12 (Open)](/task/test-task-12)";
    const newTaskList =
        "- [Test Task 9 (Open)](/task/test-task-9)\n\n" +
        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
        "- [Test Task 7 (Open)](/task/test-task-7)\n\n" +
        "- [Test Task 4 (Open)](/task/test-task-4)\n\n" +
        "- [Test Task 6 (Open)](/task/test-task-6)\n\n" +
        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
        "- [Test Task 8 (Open)](/task/test-task-8)\n\n" +
        "- [Test Task 10 (Open)](/task/test-task-10)\n\n" +
        "- [Test Task 5 (Open)](/task/test-task-5)\n\n" +
        "- [Test Task 11 (Open)](/task/test-task-11)\n\n" +
        "- [Test Task 12 (Open)](/task/test-task-12)\n\n" +
        "- [Test Task 3 (Open)](/task/test-task-3)";

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [{old: oldTaskList, new: newTaskList, replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: firstMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "Start"},
                    },
                },
                {
                    type: "Update",
                    id: secondMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: printApiTaskQueryCursorMock(2),
                            beforeCursor: printApiTaskQueryCursorMock(4),
                        },
                    },
                },
                {
                    type: "Update",
                    id: thirdMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: printApiTaskQueryCursorMock(6),
                            beforeCursor: printApiTaskQueryCursorMock(8),
                        },
                    },
                },
                {
                    type: "Update",
                    id: fourthMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: printApiTaskQueryCursorMock(10),
                            beforeCursor: printApiTaskQueryCursorMock(11),
                        },
                    },
                },
                {
                    type: "Update",
                    id: fifthMovedTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                },
            ],
        },
    ]);
});

test("moves only task 4 when moving it after task 8", async () => {
    const tasks = [
        createApiTaskMock({index: 0, title: "Task 1"}),
        createApiTaskMock({index: 1, title: "Task 2"}),
        createApiTaskMock({index: 2, title: "Task 3"}),
        createApiTaskMock({index: 3, title: "Task 4"}),
        createApiTaskMock({index: 4, title: "Task 5"}),
        createApiTaskMock({index: 5, title: "Task 6"}),
        createApiTaskMock({index: 6, title: "Task 7"}),
        createApiTaskMock({index: 7, title: "Task 8"}),
    ];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: tasks[3]!,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(8)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Task 4 (Open)](/task/task-4)\n\n",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Task 8 (Open)](/task/task-8)",
                    new: "- [Task 8 (Open)](/task/task-8)\n\n- [Task 4 (Open)](/task/task-4)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: tasks[3]!.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                },
            ],
        },
    ]);
});

test("uses a moved cursor in a later task move", async () => {
    const tasks = [
        createApiTaskMock({index: 0}),
        createApiTaskMock({index: 1}),
        createApiTaskMock({index: 2}),
        createApiTaskMock({index: 3}),
        createApiTaskMock({index: 4}),
    ];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });
    const movedCursor = "moved-task-cursor" as ApiTaskQueryCursor;

    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: tasks[1]!,
                    results: [{type: "MoveInCollection", cursor: movedCursor}],
                },
            ],
        },
    });
    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: tasks[0]!,
                    results: [{type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(5)}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    const initialTaskList =
        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
        "- [Test Task 3 (Open)](/task/test-task-3)\n\n" +
        "- [Test Task 4 (Open)](/task/test-task-4)";
    const taskListAfterFirstMove =
        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
        "- [Test Task 3 (Open)](/task/test-task-3)\n\n" +
        "- [Test Task 4 (Open)](/task/test-task-4)\n\n" +
        "- [Test Task 1 (Open)](/task/test-task-1)";

    await callAgentWebUpdateTool(context, {
        path: "/task-collection/test-task-collection",
        updates: [{old: initialTaskList, new: taskListAfterFirstMove, replaceAll: false}],
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: taskListAfterFirstMove,
                    new:
                        "- [Test Task 2 (Open)](/task/test-task-2)\n\n" +
                        "- [Test Task 3 (Open)](/task/test-task-3)\n\n" +
                        "- [Test Task 4 (Open)](/task/test-task-4)\n\n" +
                        "- [Test Task 0 (Open)](/task/test-task-0)\n\n" +
                        "- [Test Task 1 (Open)](/task/test-task-1)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: tasks[1]!.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                },
            ],
        },
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: tasks[0]!.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {
                            type: "Between",
                            afterCursor: printApiTaskQueryCursorMock(4),
                            beforeCursor: movedCursor,
                        },
                    },
                },
            ],
        },
    ]);
});

test("removes a task from a collection with a default sort", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        defaults: {
            filters: [],
            sorts: [{type: "Priority", direction: "Descending"}],
        },
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });
    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [{task: task2, results: [{type: "RemoveCollection"}]}],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "\n\n- [Test Task 1 (Open)](/task/test-task-1)",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {type: "RemoveCollection", collectionId: collection.id},
                },
            ],
        },
    ]);
});

test("removes a task from a collection with a default sort using manual order", async () => {
    const collection: ApiTaskCollectionResponse = {
        id: generateId<TaskCollectionId>(),
        name: "Test Task Collection",
        defaults: {
            filters: [],
            sorts: [{type: "Priority", direction: "Descending"}],
        },
    };
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const path = "/task-collection/test-task-collection?manual";

    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collection.id}},
        data: {
            spaceId,
            collection,
            nextCursor: null,
            tasks: [
                {cursor: printApiTaskQueryCursorMock(0), task: task1},
                {cursor: printApiTaskQueryCursorMock(1), task: task2},
            ],
        },
    });
    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [{task: task2, results: [{type: "RemoveCollection"}]}],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {path, limit: "50kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "\n\n- [Test Task 1 (Open)](/task/test-task-1)",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {type: "RemoveCollection", collectionId: collection.id},
                },
            ],
        },
    ]);
});

test("removes a task from a collection with a sort in search params", async () => {
    const collection = {
        id: generateId<TaskCollectionId>(),
        name: "Test Task Collection",
        defaults: {filters: [], sorts: []},
    };
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const path = "/task-collection/test-task-collection?sort=created";

    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collection.id}},
        data: {
            spaceId,
            collection,
            nextCursor: null,
            tasks: [
                {cursor: printApiTaskQueryCursorMock(0), task: task1},
                {cursor: printApiTaskQueryCursorMock(1), task: task2},
            ],
        },
    });
    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [{task: task2, results: [{type: "RemoveCollection"}]}],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {path, limit: "50kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "\n\n- [Test Task 1 (Open)](/task/test-task-1)",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {type: "RemoveCollection", collectionId: collection.id},
                },
            ],
        },
    ]);
});

test("removes a task from a collection with a default filter", async () => {
    const task1 = createApiTaskMock({index: 0, priority: "High"});
    const task2 = createApiTaskMock({index: 1, priority: "High"});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        defaults: {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: [{type: "High"}]},
                },
            ],
            sorts: [],
        },
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });
    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [{task: task2, results: [{type: "RemoveCollection"}]}],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "\n\n- [Test Task 1 (Open)](/task/test-task-1)\n  - Priority: High",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {type: "RemoveCollection", collectionId: collection.id},
                },
            ],
        },
    ]);
});

test("removes a task from a collection with a filter in search params", async () => {
    const collection = {
        id: generateId<TaskCollectionId>(),
        name: "Test Task Collection",
        defaults: {filters: [], sorts: []},
    };
    const task1 = createApiTaskMock({index: 0, priority: "High"});
    const task2 = createApiTaskMock({index: 1, priority: "High"});
    const path = "/task-collection/test-task-collection?priority=high";

    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collection.id}},
        data: {
            spaceId,
            collection,
            nextCursor: null,
            tasks: [
                {cursor: printApiTaskQueryCursorMock(0), task: task1},
                {cursor: printApiTaskQueryCursorMock(1), task: task2},
            ],
        },
    });
    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [{task: task2, results: [{type: "RemoveCollection"}]}],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {path, limit: "50kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "\n\n- [Test Task 1 (Open)](/task/test-task-1)\n  - Priority: High",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task2.id,
                    patch: {type: "RemoveCollection", collectionId: collection.id},
                },
            ],
        },
    ]);
});

test("rejects adding a task to a collection with a default sort", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const newTask = createApiTaskMock({index: 2});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        defaults: {
            filters: [],
            sorts: [{type: "Priority", direction: "Descending"}],
        },
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, [collection, newTask]);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 2 (Open)](/task/test-task-2)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("Tasks may only be added to task collection markdown when the collection is " +
                "sorted manually. A collection is manually sorted when no automatic sorts are " +
                "applied. That means there are no default sorts/filters and there is no " +
                "`?sort` (or filter) in the path passed to the `read` tool. To add tasks to an " +
                "automatically sorted collection, use the `read` tool to read an individual " +
                "task and add a collection to the task\u2019s \u201CCollections\u201D field with the " +
                "`update` tool. Try again without adding new tasks."),
    );
});

test("adds a task to a collection with a default sort using manual order", async () => {
    const collection: ApiTaskCollectionResponse = {
        id: generateId<TaskCollectionId>(),
        name: "Test Task Collection",
        defaults: {
            filters: [],
            sorts: [{type: "Priority", direction: "Descending"}],
        },
    };
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const {task: newTask} = mockApiGetTask(api, {spaceId, index: 2});
    const path = "/task-collection/test-task-collection?manual";

    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collection.id}},
        data: {
            spaceId,
            collection,
            nextCursor: null,
            tasks: [
                {cursor: printApiTaskQueryCursorMock(0), task: task1},
                {cursor: printApiTaskQueryCursorMock(1), task: task2},
            ],
        },
    });
    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: newTask,
                    results: [
                        {type: "AddCollection"},
                        {type: "MoveInCollection", cursor: printApiTaskQueryCursorMock(2)},
                    ],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, [collection, newTask]);

    await callAgentWebReadTool(context, {path, limit: "50kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 2 (Open)](/task/test-task-2)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: newTask.id,
                    patch: {
                        type: "AddCollection",
                        item: {
                            collection: {
                                id: collection.id,
                            },
                        },
                    },
                },
                {
                    type: "Update",
                    id: newTask.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                },
            ],
        },
    ]);
});

test("rejects adding a task to a collection with a sort in search params", async () => {
    const collection = {
        id: generateId<TaskCollectionId>(),
        name: "Test Task Collection",
        defaults: {filters: [], sorts: []},
    };
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const newTask = createApiTaskMock({index: 2});
    const path = "/task-collection/test-task-collection?sort=created";

    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collection.id}},
        data: {
            spaceId,
            collection,
            nextCursor: null,
            tasks: [
                {cursor: printApiTaskQueryCursorMock(0), task: task1},
                {cursor: printApiTaskQueryCursorMock(1), task: task2},
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, [collection, newTask]);

    await callAgentWebReadTool(context, {path, limit: "50kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path: path,
            updates: [
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 2 (Open)](/task/test-task-2)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection?sort=created`. Tasks may only be added to task collection markdown when the collection is sorted manually. A collection is manually sorted when no automatic sorts are applied. That means there are no default sorts/filters and there is no `?sort` (or filter) in the path passed to the `read` tool. To add tasks to an automatically sorted collection, use the `read` tool to read an individual task and add a collection to the task\u2019s \u201CCollections\u201D field with the `update` tool. Try again without adding new tasks.",
    );
});

test("rejects adding a task to a collection with a default filter", async () => {
    const task1 = createApiTaskMock({index: 0, priority: "High"});
    const task2 = createApiTaskMock({index: 1, priority: "High"});
    const newTask = createApiTaskMock({index: 2, priority: "High"});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        defaults: {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: [{type: "High"}]},
                },
            ],
            sorts: [],
        },
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, [collection, newTask]);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)\n  - Priority: High",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n" +
                        "  - Priority: High\n\n" +
                        "- [Test Task 2 (Open)](/task/test-task-2)\n" +
                        "  - Priority: High",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("Tasks may only be added to task collection markdown when the collection is " +
                "sorted manually. A collection is manually sorted when no automatic sorts are " +
                "applied. That means there are no default sorts/filters and there is no " +
                "`?sort` (or filter) in the path passed to the `read` tool. To add tasks to an " +
                "automatically sorted collection, use the `read` tool to read an individual " +
                "task and add a collection to the task\u2019s \u201CCollections\u201D field with the " +
                "`update` tool. Try again without adding new tasks."),
    );
});

test("rejects adding a task to a collection with a filter in search params", async () => {
    const collection = {
        id: generateId<TaskCollectionId>(),
        name: "Test Task Collection",
        defaults: {filters: [], sorts: []},
    };
    const task1 = createApiTaskMock({index: 0, priority: "High"});
    const task2 = createApiTaskMock({index: 1, priority: "High"});
    const newTask = createApiTaskMock({index: 2, priority: "High"});
    const path = "/task-collection/test-task-collection?priority=high";

    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collection.id}},
        data: {
            spaceId,
            collection,
            nextCursor: null,
            tasks: [
                {cursor: printApiTaskQueryCursorMock(0), task: task1},
                {cursor: printApiTaskQueryCursorMock(1), task: task2},
            ],
        },
    });
    await storeAgentWebPageLinkForTest(storage, [collection, newTask]);

    await callAgentWebReadTool(context, {path, limit: "50kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path: path,
            updates: [
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)\n  - Priority: High",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n" +
                        "  - Priority: High\n\n" +
                        "- [Test Task 2 (Open)](/task/test-task-2)\n" +
                        "  - Priority: High",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection?priority=high`. Tasks may only be added to task collection markdown when the collection is sorted manually. A collection is manually sorted when no automatic sorts are applied. That means there are no default sorts/filters and there is no `?sort` (or filter) in the path passed to the `read` tool. To add tasks to an automatically sorted collection, use the `read` tool to read an individual task and add a collection to the task\u2019s \u201CCollections\u201D field with the `update` tool. Try again without adding new tasks.",
    );
});

test("rejects moving a task in a collection with a default sort", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        defaults: {
            filters: [],
            sorts: [{type: "Priority", direction: "Descending"}],
        },
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 0 (Open)](/task/test-task-0)\n\n",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 0 (Open)](/task/test-task-0)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("Tasks may only be reordered in task collection markdown when the collection " +
                "is sorted manually. A collection is manually sorted when no automatic sorts " +
                "are applied. That means there are no default sorts/filters and there is no " +
                "`?sort` (or filter) in the path passed to the `read` tool. To reorder tasks in " +
                "an automatically sorted collection, look at the collection\u2019s sorts and " +
                "update the corresponding fields in the task (for example, if a collection is " +
                "sorted by `?sort=priority` then updating a task\u2019s priority will move it). If " +
                "you are updating a task\u2019s fields in an automatically sorted collection, you " +
                "shouldn\u2019t move the task yourself with the `update` tool because the task will " +
                "be moved automatically. Instead read the collection again with the `read` " +
                "tool after your update to see the new order. Try again without reordering " +
                "tasks."),
    );
});

test("moves a task in a collection with a default sort using manual order", async () => {
    const collection: ApiTaskCollectionResponse = {
        id: generateId<TaskCollectionId>(),
        name: "Test Task Collection",
        defaults: {
            filters: [],
            sorts: [{type: "Priority", direction: "Descending"}],
        },
    };
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const path = "/task-collection/test-task-collection?manual";
    const movedCursor = printApiTaskQueryCursorMock(2);

    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collection.id}},
        data: {
            spaceId,
            collection,
            nextCursor: null,
            tasks: [
                {cursor: printApiTaskQueryCursorMock(0), task: task1},
                {cursor: printApiTaskQueryCursorMock(1), task: task2},
            ],
        },
    });
    mockApiPatchTasks({
        params: "Any",
        data: {
            spaceId,
            tasks: [
                {
                    task: task1,
                    results: [{type: "MoveInCollection", cursor: movedCursor}],
                },
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {path, limit: "50kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "- [Test Task 0 (Open)](/task/test-task-0)\n\n",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 0 (Open)](/task/test-task-0)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getApiPatchTasksRequestHistory()).toEqual([
        {
            spaceId,
            patches: [
                {
                    type: "Update",
                    id: task1.id,
                    patch: {
                        type: "MoveInCollection",
                        collectionId: collection.id,
                        position: {type: "End"},
                    },
                },
            ],
        },
    ]);
});

test("rejects moving a task in a collection with a sort in search params", async () => {
    const collection = {
        id: generateId<TaskCollectionId>(),
        name: "Test Task Collection",
        defaults: {filters: [], sorts: []},
    };
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const path = "/task-collection/test-task-collection?sort=created";

    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collection.id}},
        data: {
            spaceId,
            collection,
            nextCursor: null,
            tasks: [
                {cursor: printApiTaskQueryCursorMock(0), task: task1},
                {cursor: printApiTaskQueryCursorMock(1), task: task2},
            ],
        },
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {path, limit: "50kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path: path,
            updates: [
                {
                    old: "- [Test Task 0 (Open)](/task/test-task-0)\n\n",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n\n" +
                        "- [Test Task 0 (Open)](/task/test-task-0)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection?sort=created`. Tasks may only be reordered in task collection markdown when the collection is sorted manually. A collection is manually sorted when no automatic sorts are applied. That means there are no default sorts/filters and there is no `?sort` (or filter) in the path passed to the `read` tool. To reorder tasks in an automatically sorted collection, look at the collection\u2019s sorts and update the corresponding fields in the task (for example, if a collection is sorted by `?sort=priority` then updating a task\u2019s priority will move it). If you are updating a task\u2019s fields in an automatically sorted collection, you shouldn\u2019t move the task yourself with the `update` tool because the task will be moved automatically. Instead read the collection again with the `read` tool after your update to see the new order. Try again without reordering tasks.",
    );
});

test("rejects moving a task in a collection with a default filter", async () => {
    const task1 = createApiTaskMock({index: 0, priority: "High"});
    const task2 = createApiTaskMock({index: 1, priority: "High"});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        defaults: {
            filters: [
                {
                    type: "Priority",
                    operation: {type: "OneOf", priorities: [{type: "High"}]},
                },
            ],
            sorts: [],
        },
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 0 (Open)](/task/test-task-0)\n  - Priority: High\n\n",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)\n  - Priority: High",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n" +
                        "  - Priority: High\n\n" +
                        "- [Test Task 0 (Open)](/task/test-task-0)\n" +
                        "  - Priority: High",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("Tasks may only be reordered in task collection markdown when the collection " +
                "is sorted manually. A collection is manually sorted when no automatic sorts " +
                "are applied. That means there are no default sorts/filters and there is no " +
                "`?sort` (or filter) in the path passed to the `read` tool. To reorder tasks in " +
                "an automatically sorted collection, look at the collection\u2019s sorts and " +
                "update the corresponding fields in the task (for example, if a collection is " +
                "sorted by `?sort=priority` then updating a task\u2019s priority will move it). If " +
                "you are updating a task\u2019s fields in an automatically sorted collection, you " +
                "shouldn\u2019t move the task yourself with the `update` tool because the task will " +
                "be moved automatically. Instead read the collection again with the `read` " +
                "tool after your update to see the new order. Try again without reordering " +
                "tasks."),
    );
});

test("rejects moving a task in a collection with a filter in search params", async () => {
    const collection = {
        id: generateId<TaskCollectionId>(),
        name: "Test Task Collection",
        defaults: {filters: [], sorts: []},
    };
    const task1 = createApiTaskMock({index: 0, priority: "High"});
    const task2 = createApiTaskMock({index: 1, priority: "High"});
    const path = "/task-collection/test-task-collection?priority=high";

    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collection.id}},
        data: {
            spaceId,
            collection,
            nextCursor: null,
            tasks: [
                {cursor: printApiTaskQueryCursorMock(0), task: task1},
                {cursor: printApiTaskQueryCursorMock(1), task: task2},
            ],
        },
    });
    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {path, limit: "50kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path: path,
            updates: [
                {
                    old: "- [Test Task 0 (Open)](/task/test-task-0)\n  - Priority: High\n\n",
                    new: "",
                    replaceAll: false,
                },
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)\n  - Priority: High",
                    new:
                        "- [Test Task 1 (Open)](/task/test-task-1)\n" +
                        "  - Priority: High\n\n" +
                        "- [Test Task 0 (Open)](/task/test-task-0)\n" +
                        "  - Priority: High",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection?priority=high`. Tasks may only be reordered in task collection markdown when the collection is sorted manually. A collection is manually sorted when no automatic sorts are applied. That means there are no default sorts/filters and there is no `?sort` (or filter) in the path passed to the `read` tool. To reorder tasks in an automatically sorted collection, look at the collection\u2019s sorts and update the corresponding fields in the task (for example, if a collection is sorted by `?sort=priority` then updating a task\u2019s priority will move it). If you are updating a task\u2019s fields in an automatically sorted collection, you shouldn\u2019t move the task yourself with the `update` tool because the task will be moved automatically. Instead read the collection again with the `read` tool after your update to see the new order. Try again without reordering tasks.",
    );
});

test("throws unimplemented when changing the default filters and sorts", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        defaults: {
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
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "status=open&sort=-priority,due",
                    new: "status=open,closed&sort=-priority,due",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/task-collection/test-task-collection\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Changing the default filters and sorts of a task collection hasn\u2019t been implemented yet`);
});

test("throws unimplemented when removing the default filters and sorts", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        defaults: {
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
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old:
                        "\n\nDefault filters and sorts:\n\n```\n" +
                        "status=open&sort=-priority,due\n```",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/task-collection/test-task-collection\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Changing the default filters and sorts of a task collection hasn\u2019t been implemented yet`);
});

test("rejects an unknown status filter in the default filters", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        defaults: {
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
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [{old: "status=open", new: "status=done", replaceAll: false}],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("Unexpected task status filter `status=done`. Try again with `open`, " +
                "`open-inactive`, `open-active`, or `closed` (e.g. `status=open` or " +
                "`status[not]=closed`)."),
    );
});

test("rejects changing a task link to an unknown task", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "[Test Task 1 (Open)](/task/test-task-1)",
                    new: "[Missing task](/task/missing-task)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("Couldn\u2019t find a task for the link \u201CMissing task\u201D on line 5. You may only " +
                "add a task you\u2019ve previously seen to a collection. Try calling the `create` " +
                "tool to create a new task and then add that new task to the collection, or " +
                "try calling the `search` tool to find an existing task you want to add to " +
                "the collection."),
    );
});

test("rejects replacing a task link path with a duplicate task", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 0 (Open)](/task/test-task-0)",
                    new: "- [Test Task 0 (Open)](/task/test-task-1)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("The task \u201CTest Task 1\u201D appears more than once on this task collection page. " +
                "Each task may only appear once. Try again after removing the duplicate task " +
                "link."),
    );
});

test("rejects duplicating a task link path", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 0 (Open)](/task/test-task-0)",
                    new: "- [Test Task 0 (Open)](/task/test-task-0)\n\n- [Test Task 1 (Open)](/task/test-task-1)",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("The task \u201CTest Task 1\u201D appears more than once on this task collection page. " +
                "Each task may only appear once. Try again after removing the duplicate task " +
                "link."),
    );
});

test("rejects an unexpected task collection color", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        color: "Red",
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [{old: "Color: Red", new: "Color: Magenta", replaceAll: false}],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("Unexpected task collection color \u201CMagenta\u201D on line 3. Try again with " +
                "\u201CRed\u201D, \u201COrange\u201D, \u201CYellow\u201D, \u201CGreen\u201D, \u201CCyan\u201D, " +
                "\u201CBlue\u201D, \u201CIndigo\u201D, \u201CPurple\u201D, \u201CPink\u201D, or remove the color entirely."),
    );
});

test("rejects unexpected markdown after the task list", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const tasks = [task1, task2];
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 1 (Open)](/task/test-task-1)",
                    new: "- [Test Task 1 (Open)](/task/test-task-1)\n\nThe end.",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("Unexpected markdown on line 7. Try again with only a color (e.g. `Color: Red`) " +
                "followed by a task list (an unordered list where every item is a task link) after " +
                "the task collection name."),
    );
});

test("makes no API calls when removing the end of tasks marker", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [{old: "\n\nEnd of tasks.", new: "", replaceAll: false}],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(api.getRequestHistory().filter(request => request.method === "PATCH")).toHaveLength(0);
});

test("rejects changing the next page link cursor", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 32,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    const response = await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "100b",
    });
    const nextPagePathMatch = response.match(/\[Next page »\]\(([^)]+)\)/);

    if (nextPagePathMatch === null) {
        throw new InternalError("Expected task collection next page link");
    }

    const nextPagePath = nextPagePathMatch[1]!;
    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: nextPagePath,
                    new: nextPagePath.replace(/after=[^&]+/, "after=d4e5f6"),
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("You can\u2019t update the \u201CNext page »\u201D link in task collection " +
                "markdown. Try again with a more specific update that leaves the " +
                "\u201CNext page »\u201D link unchanged."),
    );
});

test("rejects removing the next page link", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 32,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    const response = await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "100b",
    });
    const nextPagePathMatch = response.match(/\[Next page »\]\(([^)]+)\)/);

    if (nextPagePathMatch === null) {
        throw new InternalError("Expected task collection next page link");
    }

    const nextPagePath = nextPagePathMatch[1]!;
    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: `[Next page »](${nextPagePath})`,
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("You can\u2019t update the \u201CNext page »\u201D link in task collection " +
                "markdown. Try again with a more specific update that leaves the " +
                "\u201CNext page »\u201D link unchanged."),
    );
});

test("rejects adding the end of tasks marker", async () => {
    const task1 = createApiTaskMock({index: 0});
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 32,
        limit: 31,
        createTask: index => (index === 0 ? task1 : createApiTaskMock({index})),
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "100b",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/task-collection/test-task-collection",
            updates: [
                {
                    old: "- [Test Task 0 (Open)](/task/test-task-0)",
                    new: "- [Test Task 0 (Open)](/task/test-task-0)\n\nEnd of tasks.",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-collection/test-task-collection`. " +
            ("Can\u2019t add the \u201CEnd of tasks\u201D marker in an update. Only a `read` tool " +
                "call can tell you whether you\u2019re at the end of a task list or not. Try " +
                "again without adding the \u201CEnd of tasks\u201D marker."),
    );
});

test("rejects renaming the task collection on a later page", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 32,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    await storeAgentWebPageLinkForTest(storage, collection);

    const response = await callAgentWebReadTool(context, {
        path: "/task-collection/test-task-collection",
        limit: "100b",
    });
    const nextPagePathMatch = response.match(/\[Next page »\]\(([^)]+)\)/);

    if (nextPagePathMatch === null) {
        throw new InternalError("Expected task collection next page link");
    }

    const nextPagePath = nextPagePathMatch[1]!;
    const nextPageCursorHash = new URL(nextPagePath, "https://agent-web.local").searchParams.get(
        "after",
    );

    if (nextPageCursorHash === null) {
        throw new InternalError("Expected task collection cursor hash");
    }

    const nextPageCursor = await getAgentWebTaskQueryCursorForHashIfExists(
        storage,
        `TaskCollection:${collection.id}`,
        nextPageCursorHash,
    );

    if (nextPageCursor === undefined) {
        throw new InternalError("Expected task collection cursor");
    }

    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collection.id,
        totalTaskCount: 32,
        limit: 31,
        cursor: nextPageCursor,
        createTask: index => createApiTaskMock({index}),
    });

    await callAgentWebReadTool(context, {
        path: nextPagePath,
        limit: "50kb",
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: nextPagePath,
            updates: [
                {
                    old: "Tasks in Test Task Collection.",
                    new: "Tasks in Test Task Collection 2026.",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        `Error: Couldn\u2019t update \`${nextPagePath}\`. ` +
            ("You can only update the task collection name on the first page of the " +
                "collection. You must leave the `Tasks in My Collection.` line at the start of " +
                "the collection markdown in place. Try calling the `read` tool to navigate to " +
                "the first page of the collection and you can call the `update` tool on that " +
                "page to update the name."),
    );
});
