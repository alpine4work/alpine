import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiTaskMock} from "~/server/agents/api/test_helpers/create_api_task_mock.js";
import {mockApiGetTask} from "~/server/agents/api/test_helpers/mock_api_get_task.js";
import {printApiTaskQueryCursorMock} from "~/server/agents/api/test_helpers/mock_api_get_task_collection_tasks.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const launchTaskId = generateId<TaskId>();

const launchTaskReference = {
    type: "Task" as const,
    id: launchTaskId,
    title: "Launch task",
    status: {type: "Open" as const, isActive: false},
};

const {span} = testTracer.startSpan("call_agent_web_create_tool_for_task_collection.test.ts");
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
    await storeAgentWebPageLinkForTest(storage, [context.botAccount, launchTaskReference]);
});

function getApiPostTaskCollectionsRequestHistory() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "POST" && request.path === "/task-collections")
        .map(({body}) => body);
}

test.each([
    ["without", ""],
    ["with", "\n\nEnd of tasks."],
])("creates a task collection %s the end of tasks marker", async (_name, endOfTasksMarker) => {
    api.mockPost("/task-collections", {
        params: "Any",
        data: {
            spaceId,
            collection: {
                id: generateId<TaskCollectionId>(),
                name: "Roadmap",
                defaults: {filters: [], sorts: []},
            },
        },
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collection",
            content: `# Roadmap${endOfTasksMarker}`,
        }),
    ).resolves.toEqual(
        "Create was successful. New task collection: [Roadmap](/task-collection/roadmap).",
    );

    expect(getApiPostTaskCollectionsRequestHistory()).toEqual([
        {
            spaceId,
            collection: {
                name: "Roadmap",
                color: undefined,
            },
        },
    ]);
});

test("creates a task collection with a color", async () => {
    api.mockPost("/task-collections", {
        params: "Any",
        data: {
            spaceId,
            collection: {
                id: generateId<TaskCollectionId>(),
                name: "Roadmap",
                color: "Blue",
                defaults: {filters: [], sorts: []},
            },
        },
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collection",
            content: `\
# Roadmap

Color: Blue`,
        }),
    ).resolves.toEqual(
        "Create was successful. New task collection: [Roadmap](/task-collection/roadmap).",
    );

    expect(getApiPostTaskCollectionsRequestHistory()).toEqual([
        {
            spaceId,
            collection: {
                name: "Roadmap",
                color: "Blue",
            },
        },
    ]);
});

test("creates a task collection with a none color", async () => {
    api.mockPost("/task-collections", {
        params: "Any",
        data: {
            spaceId,
            collection: {
                id: generateId<TaskCollectionId>(),
                name: "Roadmap",
                defaults: {filters: [], sorts: []},
            },
        },
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collection",
            content: `\
# Roadmap

Color: None`,
        }),
    ).resolves.toEqual(
        "Create was successful. New task collection: [Roadmap](/task-collection/roadmap).",
    );

    expect(getApiPostTaskCollectionsRequestHistory()).toEqual([
        {
            spaceId,
            collection: {
                name: "Roadmap",
                color: undefined,
            },
        },
    ]);
});

test("creates a task collection with the normalized task collect type", async () => {
    api.mockPost("/task-collections", {
        params: "Any",
        data: {
            spaceId,
            collection: {
                id: generateId<TaskCollectionId>(),
                name: "Roadmap",
                defaults: {filters: [], sorts: []},
            },
        },
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collect",
            content: "# Roadmap",
        }),
    ).resolves.toEqual(
        "Create was successful. New task collection: [Roadmap](/task-collection/roadmap).",
    );
});

test("creates a task collection with a task", async () => {
    const {task} = mockApiGetTask(api, {
        spaceId,
        id: launchTaskId,
        title: "Launch task",
    });
    const collectionId = generateId<TaskCollectionId>();

    api.mockPost("/task-collections", {
        params: "Any",
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Roadmap",
                color: "Red",
                defaults: {filters: [], sorts: []},
            },
        },
    });
    api.mockPatch("/tasks", {
        params: "Any",
        data: {
            spaceId,
            tasks: [task],
            results: [
                {type: "Update", result: {type: "AddCollection"}},
                {
                    type: "Update",
                    result: {
                        type: "MoveInCollection",
                        cursor: printApiTaskQueryCursorMock(0),
                    },
                },
            ],
        },
    });

    const result = await callAgentWebCreateTool(context, {
        type: "task-collection",
        content: `\
# Roadmap

Color: Red

- [Launch task (Open)](/task/launch-task)`,
    });
    const storedPage = await storage.readResponseByPath.get("/task-collection/roadmap");

    expect({
        result,
        requestOrder: api.getRequestHistory().map(({method, path}) => `${method} ${path}`),
        createCollection: getApiPostTaskCollectionsRequestHistory(),
        taskPatches: api
            .getRequestHistory()
            .filter(request => request.method === "PATCH" && request.path === "/tasks")
            .map(({body}) => body),
        pageMetadata: storedPage?.pageMetadata,
    }).toEqual({
        result: "Create was successful. New task collection: [Roadmap](/task-collection/roadmap).",
        requestOrder: ["GET /tasks/{id}", "POST /task-collections", "PATCH /tasks"],
        createCollection: [
            {
                spaceId,
                collection: {name: "Roadmap", color: "Red"},
            },
        ],
        taskPatches: [
            {
                spaceId,
                patches: [
                    {
                        type: "Update",
                        id: launchTaskId,
                        patch: {
                            type: "AddCollection",
                            item: {collection: {id: collectionId}},
                        },
                    },
                    {
                        type: "Update",
                        id: launchTaskId,
                        patch: {
                            type: "MoveInCollection",
                            collectionId,
                            position: {type: "End"},
                        },
                    },
                ],
            },
        ],
        pageMetadata: {
            type: "TaskCollection",
            id: collectionId,
            afterCursor: null,
            beforeCursor: null,
            isManuallyOrdered: true,
            tasks: [{cursor: printApiTaskQueryCursorMock(0), newTaskId: null}],
        },
    });
});

test("creates a task collection with a new task and all its fields", async () => {
    const collectionId = generateId<TaskCollectionId>();
    const otherCollectionId = generateId<TaskCollectionId>();
    const createdTask = createApiTaskMock({index: 10, title: "Draft launch plan"});

    await storeAgentWebPageLinkForTest(storage, {
        type: "TaskCollection",
        id: otherCollectionId,
        title: "Operations",
    });
    api.mockPost("/task-collections", {
        params: "Any",
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Release plan",
                defaults: {filters: [], sorts: []},
            },
        },
    });
    api.mockPatch("/tasks", {
        params: "Any",
        data: {
            spaceId,
            tasks: [omitObject(createdTask, ["notes"])],
            results: [
                {
                    type: "Create",
                    task: {id: createdTask.id},
                    results: [
                        {
                            type: "MoveInCollection",
                            cursor: printApiTaskQueryCursorMock(10),
                        },
                    ],
                },
            ],
        },
    });

    const result = await callAgentWebCreateTool(context, {
        type: "task-collection",
        content: `\
# Release plan

- Draft launch plan (Open, active)
  - Parent: [Launch task](/task/launch-task)
  - Assignee: [ChatGPT](/bot/chatgpt)
  - Collections: [Operations](/task-collection/operations)
  - Priority: Urgent
  - Due date: July 12th, 2027`,
    });
    const storedPage = await storage.readResponseByPath.get("/task-collection/release-plan");

    expect({
        result,
        requestOrder: api.getRequestHistory().map(({method, path}) => `${method} ${path}`),
        taskPatches: api
            .getRequestHistory()
            .filter(request => request.method === "PATCH" && request.path === "/tasks")
            .map(request => request.body),
        pageMetadata: storedPage?.pageMetadata,
    }).toEqual({
        result: `\
Create was successful. New task collection: [Release plan](/task-collection/release-plan).

Also created the following task: [Draft launch plan (Open, active)](/task/draft-launch-plan).`,
        requestOrder: ["POST /task-collections", "PATCH /tasks"],
        taskPatches: [
            {
                spaceId,
                patches: [
                    {
                        type: "Create",
                        task: {
                            title: "Draft launch plan",
                            status: {type: "Open", isActive: true},
                            parent: {task: {id: launchTaskId}},
                            assignee: {id: context.botAccount.id},
                            collections: [
                                {collection: {id: otherCollectionId}},
                                {collection: {id: collectionId}},
                            ],
                            priority: {type: "Urgent"},
                            due: {date: "2027-07-12"},
                        },
                        patches: [
                            {
                                type: "MoveInCollection",
                                collectionId,
                                position: {type: "End"},
                            },
                        ],
                    },
                ],
            },
        ],
        pageMetadata: {
            type: "TaskCollection",
            id: collectionId,
            afterCursor: null,
            beforeCursor: null,
            isManuallyOrdered: true,
            tasks: [{cursor: printApiTaskQueryCursorMock(10), newTaskId: createdTask.id}],
        },
    });
});

test("doesn\u2019t recreate a link-less task in a later collection update", async () => {
    const collectionId = generateId<TaskCollectionId>();
    const createdTask = createApiTaskMock({index: 11, title: "Draft launch plan"});

    api.mockPost("/task-collections", {
        params: "Any",
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Release plan",
                defaults: {filters: [], sorts: []},
            },
        },
    });
    api.mockPatch("/tasks", {
        params: "Any",
        data: {
            spaceId,
            tasks: [omitObject(createdTask, ["notes"])],
            results: [
                {
                    type: "Create",
                    task: {id: createdTask.id},
                    results: [
                        {
                            type: "MoveInCollection",
                            cursor: printApiTaskQueryCursorMock(11),
                        },
                    ],
                },
            ],
        },
    });
    api.mockPatch("/task-collections/{id}", {
        params: {path: {id: collectionId}},
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Updated release plan",
                defaults: {filters: [], sorts: []},
            },
        },
    });

    await callAgentWebCreateTool(context, {
        type: "task-collection",
        content: `\
# Release plan

- Draft launch plan (Open)`,
    });
    const updateResult = await callAgentWebUpdateTool(context, {
        path: "/task-collection/release-plan",
        updates: [
            {
                old: "# Release plan",
                new: "# Updated release plan",
                replaceAll: false,
            },
        ],
    });

    expect({
        updateResult,
        taskPatches: api
            .getRequestHistory()
            .filter(request => request.method === "PATCH" && request.path === "/tasks")
            .map(request => request.body),
        collectionPatches: api
            .getRequestHistory()
            .filter(
                request => request.method === "PATCH" && request.path === "/task-collections/{id}",
            )
            .map(request => request.body),
    }).toEqual({
        updateResult: "Update was successful.",
        taskPatches: [
            {
                spaceId,
                patches: [
                    {
                        type: "Create",
                        task: {
                            title: "Draft launch plan",
                            status: {type: "Open", isActive: false},
                            collections: [{collection: {id: collectionId}}],
                        },
                        patches: [
                            {
                                type: "MoveInCollection",
                                collectionId,
                                position: {type: "End"},
                            },
                        ],
                    },
                ],
            },
        ],
        collectionPatches: [{patches: [{type: "SetName", name: "Updated release plan"}]}],
    });
});

test("creates a task collection with multiple tasks in their written order", async () => {
    const {task: launchTask} = mockApiGetTask(api, {
        spaceId,
        id: launchTaskId,
        title: "Launch task",
    });
    const {task: secondTask} = mockApiGetTask(api, {
        spaceId,
        index: 2,
        title: "Second task",
        status: "Closed",
        priority: "High",
        due: "2027-07-12",
    });
    await storeAgentWebPageLinkForTest(storage, secondTask);

    const collectionId = generateId<TaskCollectionId>();
    api.mockPost("/task-collections", {
        params: "Any",
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Release plan",
                defaults: {filters: [], sorts: []},
            },
        },
    });
    api.mockPatch("/tasks", {
        params: "Any",
        data: {
            spaceId,
            tasks: [launchTask, secondTask],
            results: [
                {type: "Update", result: {type: "AddCollection"}},
                {
                    type: "Update",
                    result: {
                        type: "MoveInCollection",
                        cursor: printApiTaskQueryCursorMock(10),
                    },
                },
                {type: "Update", result: {type: "AddCollection"}},
                {
                    type: "Update",
                    result: {
                        type: "MoveInCollection",
                        cursor: printApiTaskQueryCursorMock(11),
                    },
                },
            ],
        },
    });

    const result = await callAgentWebCreateTool(context, {
        type: "task-collection",
        content: `\
# Release plan

- [Launch task (Open)](/task/launch-task)
- [Second task (Closed)](/task/second-task)
  - Priority: High
  - Due date: July 12th, 2027`,
    });
    const storedPage = await storage.readResponseByPath.get("/task-collection/release-plan");

    expect({
        result,
        taskPatches: api
            .getRequestHistory()
            .filter(request => request.method === "PATCH" && request.path === "/tasks")
            .map(({body}) => body),
        pageMetadata: storedPage?.pageMetadata,
    }).toEqual({
        result:
            "Create was successful. New task collection: " +
            "[Release plan](/task-collection/release-plan).",
        taskPatches: [
            {
                spaceId,
                patches: [
                    {
                        type: "Update",
                        id: launchTask.id,
                        patch: {
                            type: "AddCollection",
                            item: {collection: {id: collectionId}},
                        },
                    },
                    {
                        type: "Update",
                        id: launchTask.id,
                        patch: {
                            type: "MoveInCollection",
                            collectionId,
                            position: {type: "End"},
                        },
                    },
                    {
                        type: "Update",
                        id: secondTask.id,
                        patch: {
                            type: "AddCollection",
                            item: {collection: {id: collectionId}},
                        },
                    },
                    {
                        type: "Update",
                        id: secondTask.id,
                        patch: {
                            type: "MoveInCollection",
                            collectionId,
                            position: {type: "End"},
                        },
                    },
                ],
            },
        ],
        pageMetadata: {
            type: "TaskCollection",
            id: collectionId,
            afterCursor: null,
            beforeCursor: null,
            isManuallyOrdered: true,
            tasks: [
                {cursor: printApiTaskQueryCursorMock(10), newTaskId: null},
                {cursor: printApiTaskQueryCursorMock(11), newTaskId: null},
            ],
        },
    });
});

test("validates task fields before creating a task collection", async () => {
    mockApiGetTask(api, {
        spaceId,
        id: launchTaskId,
        title: "Launch task",
        status: "Closed",
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collection",
            content: `\
# Roadmap

- [Renamed launch task (Open)](/task/launch-task)`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create task collection. " +
            ("You can\u2019t change the task \u201CRenamed launch task\u201D\u2019s title or fields while adding " +
                "it to task collection markdown. Add the task with its current title and fields, " +
                "then call the `update` tool again if you want to change its title or fields. " +
                "Try again with this exact markdown for the task: " +
                "`- [Launch task (Closed)](/task/launch-task)`"),
    );

    expect(api.getRequestHistory().map(({method, path}) => `${method} ${path}`)).toEqual([
        "GET /tasks/{id}",
    ]);
    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});

test("validates a new task\u2019s additional collection count before creating a collection", async () => {
    await storeAgentWebPageLinkForTest(storage, {
        type: "TaskCollection",
        id: generateId<TaskCollectionId>(),
        title: "Operations",
    });

    const result = await callAgentWebCreateTool(context, {
        type: "task-collection",
        content: `\
# Roadmap

- Draft launch plan (Open)
  - Collections: [Operations](/task-collection/operations), and 2 more`,
    });

    expect({result, requests: api.getRequestHistory()}).toEqual({
        result:
            "Error: Couldn\u2019t create task collection. " +
            ("Can\u2019t create the task \u201CDraft launch plan\u201D with an \u201Cand 2 more\u201D collection " +
                "count since we don\u2019t know which underlying collections you\u2019re trying to add. " +
                "Try again after removing the count or replacing it with links to the underlying " +
                "collections."),
        requests: [],
    });
});

test("validates a new task\u2019s subtask counts before creating a collection", async () => {
    const result = await callAgentWebCreateTool(context, {
        type: "task-collection",
        content: `\
# Roadmap

- Draft launch plan (Open)
  - Subtasks: 2 open, 1 closed`,
    });

    expect({result, requests: api.getRequestHistory()}).toEqual({
        result:
            "Error: Couldn\u2019t create task collection. " +
            ("Can\u2019t create the task \u201CDraft launch plan\u201D with a \u201CSubtasks\u201D field since we don\u2019t " +
                "know what the underlying subtasks are. Try again after removing the \u201CSubtasks\u201D " +
                "field, then call the `read` tool on the newly created task and use the `update` " +
                "tool to add subtasks to the newly created task."),
        requests: [],
    });
});

test("validates a new active task\u2019s assignee before creating a collection", async () => {
    const result = await callAgentWebCreateTool(context, {
        type: "task-collection",
        content: `\
# Roadmap

- Draft launch plan (Open, active)`,
    });

    expect({result, requests: api.getRequestHistory()}).toEqual({
        result:
            "Error: Couldn\u2019t create task collection. " +
            ("Can\u2019t create the task \u201CDraft launch plan\u201D as active if there\u2019s no assignee. We " +
                "don\u2019t recommend setting a task as active unless you\u2019re about to work on the " +
                "task or you know someone else is currently working on the task. Try again and " +
                "either create the task as open but inactive (e.g. \u201C(Open)\u201D) or set an assignee " +
                "(e.g. `- Assignee: [ChatGPT](/bot/chatgpt)`)."),
        requests: [],
    });
});

test("validates duplicate tasks before creating a task collection", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collection",
            content: `\
# Roadmap

- [Launch task (Open)](/task/launch-task)
- [Launch task (Open)](/task/launch-task)`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create task collection. " +
            ("The task \u201CLaunch task\u201D appears more than once on this task collection page. " +
                "Each task may only appear once. Try again after removing the duplicate task link."),
    );

    expect(api.getRequestHistory()).toHaveLength(0);
    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});

test("throws unimplemented when creating a task collection with default filters and sorts", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collection",
            content: `\
# Roadmap

Default filters and sorts:

\`\`\`
?status=open&sort=-priority,due
\`\`\``,
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t create task collection. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Setting the default filters and sorts while creating a task collection hasn\u2019t been implemented yet`);
    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});

test("rejects creating a task collection without a name", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collection",
            content: "Color: Red",
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create task collection. " +
            ("Task collection markdown must start with a name (e.g. `# My Collection`) " +
                "when creating a collection. Try again with a name."),
    );

    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});

test("rejects creating a later task collection page", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collection",
            content: "Tasks in Roadmap.",
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create task collection. " +
            ("Task collection markdown must start with a name (e.g. `# My Collection`) " +
                "when creating a collection. Try again with a name."),
    );

    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});

test("rejects creating a task collection with an unexpected color", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collection",
            content: `\
# Roadmap

Color: Magenta`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create task collection. " +
            ("Unexpected task collection color \u201CMagenta\u201D on line 3. Try again with " +
                "\u201CRed\u201D, \u201COrange\u201D, \u201CYellow\u201D, \u201CGreen\u201D, \u201CCyan\u201D, " +
                "\u201CBlue\u201D, \u201CIndigo\u201D, \u201CPurple\u201D, \u201CPink\u201D, or remove the color entirely."),
    );

    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});

test("rejects creating a task collection with an unknown task link", async () => {
    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collection",
            content: `\
# Roadmap

- [Missing task](/task/missing-task)`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create task collection. " +
            ("Couldn\u2019t find a task for the link \u201CMissing task\u201D on line 3. You may " +
                "only add a task you\u2019ve previously seen to a collection. Try calling the " +
                "`create` tool to create a new task and then add that new task to the " +
                "collection, or try calling the `search` tool to find an existing task you " +
                "want to add to the collection."),
    );

    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});

test("rejects creating a task collection with a next page link", async () => {
    await storeAgentWebPageLinkForTest(storage, {
        type: "TaskCollection",
        id: generateId<TaskCollectionId>(),
        title: "Roadmap",
    });

    await expect(
        callAgentWebCreateTool(context, {
            type: "task-collection",
            content: `\
# Roadmap 2026

[Next page »](/task-collection/roadmap?after=a1b2c3)`,
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t create task collection. " +
            ("You can\u2019t include a \u201CNext page »\u201D link when creating a task collection. " +
                "Try again without a \u201CNext page »\u201D link."),
    );

    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});
