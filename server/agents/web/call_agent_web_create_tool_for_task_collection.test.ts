import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {mockApiGetTask} from "~/server/agents/api/test_helpers/mock_api_get_task.js";
import {printApiTaskQueryCursorMock} from "~/server/agents/api/test_helpers/mock_api_get_task_collection_tasks.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {printAgentWebError} from "~/server/agents/web/print_agent_web_error.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {InternalError, UnimplementedError} from "~/shared/error/error.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
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
    await createAgentWebPageStoredLinkPathname(storage, context.botAccount);
    await createAgentWebPageStoredLinkPathname(storage, launchTaskReference);
});

function getApiPostTaskCollectionsRequestHistory() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "POST" && request.path === "/task-collections")
        .map(({body}) => body);
}

async function expectInvalidCreateDisplayMessage({
    content,
    expected,
}: {
    content: string;
    expected: string;
}) {
    const result = await captureResultPromise(
        async () => await callAgentWebCreateTool(context, {type: "task-collection", content}),
    );

    if (result.ok) {
        throw new InternalError("Expected create tool call to throw");
    }

    expect(await printAgentWebError("Create failed", result.error)).toEqual(
        `Error: Create failed. ${expected}`,
    );
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
        "Create was successful. New task collection: [Roadmap](/task-collection/roadmap).\n",
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
        "Create was successful. New task collection: [Roadmap](/task-collection/roadmap).\n",
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
        "Create was successful. New task collection: [Roadmap](/task-collection/roadmap).\n",
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
        "Create was successful. New task collection: [Roadmap](/task-collection/roadmap).\n",
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
        result: "Create was successful. New task collection: [Roadmap](/task-collection/roadmap).\n",
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
            tasks: [{cursor: printApiTaskQueryCursorMock(0)}],
        },
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
                {type: "Update", result: {type: "AddCollection"}},
                {
                    type: "Update",
                    result: {
                        type: "MoveInCollection",
                        cursor: printApiTaskQueryCursorMock(10),
                    },
                },
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
            "[Release plan](/task-collection/release-plan).\n",
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
                        id: secondTask.id,
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
                {cursor: printApiTaskQueryCursorMock(10)},
                {cursor: printApiTaskQueryCursorMock(11)},
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

    await expectInvalidCreateDisplayMessage({
        content: `\
# Roadmap

- [Renamed launch task (Open)](/task/launch-task)`,
        expected:
            "You can’t change the task “Renamed launch task”’s title or fields while adding " +
            "it to task collection markdown. Add the task with its current title and fields, " +
            "then call the `update` tool again if you want to change its title or fields. " +
            "Try again with this exact markdown for the task: " +
            "`- [Launch task (Closed)](/task/launch-task)`",
    });

    expect(api.getRequestHistory().map(({method, path}) => `${method} ${path}`)).toEqual([
        "GET /tasks/{id}",
    ]);
    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});

test("validates duplicate tasks before creating a task collection", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
# Roadmap

- [Launch task (Open)](/task/launch-task)
- [Launch task (Open)](/task/launch-task)`,
        expected:
            "The task “Launch task” appears more than once on this task collection page. " +
            "Each task may only appear once. Try again after removing the duplicate task link.",
    });

    expect(api.getRequestHistory()).toHaveLength(0);
    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});

test("throws unimplemented when creating a task collection with default filters and sorts", async () => {
    const result = await captureResultPromise(
        async () =>
            await callAgentWebCreateTool(context, {
                type: "task-collection",
                content: `\
# Roadmap

Default filters and sorts:

\`\`\`
?status=open&sort=-priority,due
\`\`\``,
            }),
    );

    if (result.ok) {
        throw new InternalError("Expected create tool call to throw");
    }

    expect(result.error).toBeInstanceOf(UnimplementedError);
    expect(result.error).toHaveProperty(
        "message",
        "Setting the default filters and sorts while creating a task collection " +
            "hasn\u2019t been implemented yet",
    );
    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});

test("rejects creating a task collection without a name", async () => {
    await expectInvalidCreateDisplayMessage({
        content: "Color: Red",
        expected:
            "Task collection markdown must start with a name (e.g. `# My Collection`) " +
            "when creating a collection. Try again with a name.",
    });

    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});

test("rejects creating a later task collection page", async () => {
    await expectInvalidCreateDisplayMessage({
        content: "Tasks in Roadmap.",
        expected:
            "Task collection markdown must start with a name (e.g. `# My Collection`) " +
            "when creating a collection. Try again with a name.",
    });

    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});

test("rejects creating a task collection with an unexpected color", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
# Roadmap

Color: Magenta`,
        expected:
            "Unexpected task collection color \u201CMagenta\u201D on line 3. Try again with " +
            "\u201CRed\u201D, \u201COrange\u201D, \u201CYellow\u201D, \u201CGreen\u201D, \u201CCyan\u201D, " +
            "\u201CBlue\u201D, \u201CIndigo\u201D, \u201CPurple\u201D, \u201CPink\u201D, or remove the color entirely.",
    });

    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});

test("rejects creating a task collection with an unknown task link", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
# Roadmap

- [Missing task](/task/missing-task)`,
        expected:
            "Couldn\u2019t find a task for the link \u201CMissing task\u201D on line 3. You may " +
            "only add a task you\u2019ve previously seen to a collection. Try calling the " +
            "`create` tool to create a new task and then add that new task to the " +
            "collection, or try calling the `search` tool to find an existing task you " +
            "want to add to the collection.",
    });

    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});

test("rejects creating a task collection with a next page link", async () => {
    await createAgentWebPageStoredLinkPathname(storage, {
        type: "TaskCollection",
        id: generateId<TaskCollectionId>(),
        title: "Roadmap",
    });

    await expectInvalidCreateDisplayMessage({
        content: `\
# Roadmap 2026

[Next page »](/task-collection/roadmap?after=a1b2c3)`,
        expected:
            "You can\u2019t include a \u201CNext page »\u201D link when creating a task collection. " +
            "Try again without a \u201CNext page »\u201D link.",
    });

    expect(getApiPostTaskCollectionsRequestHistory()).toHaveLength(0);
});
