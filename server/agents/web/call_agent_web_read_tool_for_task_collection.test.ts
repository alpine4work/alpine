import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {createApiTaskMock} from "~/server/agents/api/test_helpers/create_api_task_mock.js";
import {
    mockGetApiTaskCollectionTasks,
    printApiTaskQueryCursorMock,
} from "~/server/agents/api/test_helpers/mock_api_get_task_collection_tasks.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {createAgentWebTaskQueryCursorHash} from "~/server/agents/web/agent_web_task_query_cursor_hash.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {ApiTaskQueryDefaultsResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const collectionId = generateId<TaskCollectionId>();

const {span} = testTracer.startSpan("call_agent_web_read_tool_for_task_collection.test.ts");
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
    await storeAgentWebPageLinkForTest(storage, [
        context.botAccount,
        {
            type: "TaskCollection",
            id: collectionId,
            title: "Roadmap",
        },
    ]);
});

function getApiGetTaskCollectionTasksRequestHistory() {
    return api
        .getRequestHistory()
        .filter(
            request => request.method === "GET" && request.path === "/task-collections/{id}/tasks",
        );
}

function getApiPostTaskCollectionTasksQueryRequestHistory() {
    return api
        .getRequestHistory()
        .filter(
            request =>
                request.method === "POST" && request.path === "/task-collections/{id}/tasks-query",
        );
}

test("reads a task collection page with tasks", async () => {
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index, title: `Test task ${index + 1}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "10kb"}))
        .toEqual(`\
# Roadmap

Color: Red

- [Test task 1 (Open)](/task/test-task-1)

- [Test task 2 (Open)](/task/test-task-2)

End of tasks.`);
});

test("reads a task collection page with task fields", async () => {
    const aliceAccount = createApiAccountMock({name: "Alice"});

    // The current "Roadmap" collection is included in each task's collections like the
    // real API would and is expected to be filtered out of the "Collections" task
    // field.
    const roadmapCollection = {id: collectionId, name: "Roadmap"};
    const engineeringCollection = {id: generateId<TaskCollectionId>(), name: "Engineering"};
    const designCollection = {id: generateId<TaskCollectionId>(), name: "Design"};
    const growthCollection = {id: generateId<TaskCollectionId>(), name: "Growth"};
    const marketingCollection = {id: generateId<TaskCollectionId>(), name: "Marketing"};

    const tasks = [
        createApiTaskMock({
            index: 0,
            title: "Write spec",
            parent: {title: "Plan launch"},
            assignee: aliceAccount,
            collections: [
                roadmapCollection,
                engineeringCollection,
                designCollection,
                growthCollection,
                marketingCollection,
            ],
            priority: "High",
            due: "2027-07-12",
        }),
        createApiTaskMock({
            index: 1,
            title: "Review spec",
            collections: [
                roadmapCollection,
                engineeringCollection,
                designCollection,
                growthCollection,
            ],
            priority: "Low",
        }),
        createApiTaskMock({
            index: 2,
            title: "Ship launch",
            status: "Closed",
            collections: [roadmapCollection],
        }),
    ];

    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "10kb"}))
        .toEqual(`\
# Roadmap

Color: Red

- [Write spec (Open)](/task/write-spec)
  - Parent: [Plan launch](/task/plan-launch)
  - Assignee: [Alice](/human/alice)
  - Collections: [Engineering](/task-collection/engineering), [Design](/task-collection/design), [Growth](/task-collection/growth), and 1 more
  - Priority: High
  - Due date: July 12th, 2027

- [Review spec (Open)](/task/review-spec)
  - Collections: [Engineering](/task-collection/engineering), [Design](/task-collection/design), [Growth](/task-collection/growth)
  - Priority: Low

- [Ship launch (Closed)](/task/ship-launch)

End of tasks.`);
});

test("truncates tasks with task fields at a task list item boundary", async () => {
    const tasks = [
        createApiTaskMock({index: 0, title: "Write spec", priority: "High"}),
        createApiTaskMock({index: 1, title: "Ship launch", priority: "Low"}),
    ];

    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: tasks.length,
        limit: 31,
        createTask: index => tasks[index]!,
    });

    const expectedResponse = `\
# Roadmap

Color: Red

[Next page »](/task-collection/roadmap?after=f8bc90)

- [Write spec (Open)](/task/write-spec)
  - Priority: High`;

    expect(
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap",
            limit: `${expectedResponse.length + 1}b`,
        }),
    ).toEqual(expectedResponse);
});

test("reads a task collection page without a color", async () => {
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        totalTaskCount: 1,
        limit: 31,
        createTask: index => createApiTaskMock({index, title: `Test task ${index + 1}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "10kb"}))
        .toEqual(`\
# Roadmap

- [Test task 1 (Open)](/task/test-task-1)

End of tasks.`);
});

test("reads a task collection page with default filters and sorts", async () => {
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 1,
        limit: 31,
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
        createTask: index => createApiTaskMock({index, title: `Test task ${index + 1}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "10kb"}))
        .toEqual(`\
# Roadmap

Color: Red

Default filters and sorts:

\`\`\`
status=open&sort=-priority,due
\`\`\`

- [Test task 1 (Open)](/task/test-task-1)

End of tasks.`);
});

test("does not print the default filters and sorts on a later page", async () => {
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 35,
        limit: 31,
        cursor: printApiTaskQueryCursorMock(29),
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
            sorts: [],
        },
        createTask: index => createApiTaskMock({index, title: `Test task ${index + 1}`}),
    });

    // Store the full cursor for the `?after` hash like the read that printed the "Next
    // page »" link would have.
    await createAgentWebTaskQueryCursorHash(
        storage,
        `TaskCollection:${collectionId}`,
        printApiTaskQueryCursorMock(29),
    );

    expect(
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?after=a3b00b",
            limit: "10kb",
        }),
    ).toEqual(`\
Tasks in Roadmap.

- [Test task 31 (Open)](/task/test-task-31)

- [Test task 32 (Open)](/task/test-task-32)

- [Test task 33 (Open)](/task/test-task-33)

- [Test task 34 (Open)](/task/test-task-34)

- [Test task 35 (Open)](/task/test-task-35)

End of tasks.`);
});

test("reads a task collection page without tasks", async () => {
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 0,
        limit: 31,
        createTask: index => createApiTaskMock({index, title: `Test task ${index + 1}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "10kb"}))
        .toEqual(`\
# Roadmap

Color: Red

End of tasks.`);
});

test("loads more task pages while the response is still under the limit", async () => {
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 35,
        limit: 31,
        createTask: index => createApiTaskMock({index, title: `Test task ${index + 1}`}),
    });
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 35,
        limit: 31,
        cursor: printApiTaskQueryCursorMock(30),
        createTask: index => createApiTaskMock({index, title: `Test task ${index + 1}`}),
    });

    const response = await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "10kb",
    });
    const taskRequestParams = getApiGetTaskCollectionTasksRequestHistory().map(
        request => request.params,
    );

    expect({response, taskRequestParams}).toEqual({
        taskRequestParams: [
            {
                path: {id: collectionId},
                query: {
                    limit: 31,
                    cursor: undefined,
                },
            },
            {
                path: {id: collectionId},
                query: {
                    limit: 31,
                    cursor: printApiTaskQueryCursorMock(30),
                },
            },
        ],
        response: `\
# Roadmap

Color: Red

- [Test task 1 (Open)](/task/test-task-1)\n
- [Test task 2 (Open)](/task/test-task-2)\n
- [Test task 3 (Open)](/task/test-task-3)\n
- [Test task 4 (Open)](/task/test-task-4)\n
- [Test task 5 (Open)](/task/test-task-5)\n
- [Test task 6 (Open)](/task/test-task-6)\n
- [Test task 7 (Open)](/task/test-task-7)\n
- [Test task 8 (Open)](/task/test-task-8)\n
- [Test task 9 (Open)](/task/test-task-9)\n
- [Test task 10 (Open)](/task/test-task-10)\n
- [Test task 11 (Open)](/task/test-task-11)\n
- [Test task 12 (Open)](/task/test-task-12)\n
- [Test task 13 (Open)](/task/test-task-13)\n
- [Test task 14 (Open)](/task/test-task-14)\n
- [Test task 15 (Open)](/task/test-task-15)\n
- [Test task 16 (Open)](/task/test-task-16)\n
- [Test task 17 (Open)](/task/test-task-17)\n
- [Test task 18 (Open)](/task/test-task-18)\n
- [Test task 19 (Open)](/task/test-task-19)\n
- [Test task 20 (Open)](/task/test-task-20)\n
- [Test task 21 (Open)](/task/test-task-21)\n
- [Test task 22 (Open)](/task/test-task-22)\n
- [Test task 23 (Open)](/task/test-task-23)\n
- [Test task 24 (Open)](/task/test-task-24)\n
- [Test task 25 (Open)](/task/test-task-25)\n
- [Test task 26 (Open)](/task/test-task-26)\n
- [Test task 27 (Open)](/task/test-task-27)\n
- [Test task 28 (Open)](/task/test-task-28)\n
- [Test task 29 (Open)](/task/test-task-29)\n
- [Test task 30 (Open)](/task/test-task-30)\n
- [Test task 31 (Open)](/task/test-task-31)\n
- [Test task 32 (Open)](/task/test-task-32)\n
- [Test task 33 (Open)](/task/test-task-33)\n
- [Test task 34 (Open)](/task/test-task-34)\n
- [Test task 35 (Open)](/task/test-task-35)

End of tasks.`,
    });
});

test("does not load more or truncate when the response is exactly at the limit", async () => {
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 35,
        limit: 31,
        createTask: index => createApiTaskMock({index, title: `Test task ${index + 1}`}),
    });

    const expectedResponse = `\
# Roadmap

Color: Red

[Next page »](/task-collection/roadmap?after=a3b00b)\n
- [Test task 1 (Open)](/task/test-task-1)\n
- [Test task 2 (Open)](/task/test-task-2)\n
- [Test task 3 (Open)](/task/test-task-3)\n
- [Test task 4 (Open)](/task/test-task-4)\n
- [Test task 5 (Open)](/task/test-task-5)\n
- [Test task 6 (Open)](/task/test-task-6)\n
- [Test task 7 (Open)](/task/test-task-7)\n
- [Test task 8 (Open)](/task/test-task-8)\n
- [Test task 9 (Open)](/task/test-task-9)\n
- [Test task 10 (Open)](/task/test-task-10)\n
- [Test task 11 (Open)](/task/test-task-11)\n
- [Test task 12 (Open)](/task/test-task-12)\n
- [Test task 13 (Open)](/task/test-task-13)\n
- [Test task 14 (Open)](/task/test-task-14)\n
- [Test task 15 (Open)](/task/test-task-15)\n
- [Test task 16 (Open)](/task/test-task-16)\n
- [Test task 17 (Open)](/task/test-task-17)\n
- [Test task 18 (Open)](/task/test-task-18)\n
- [Test task 19 (Open)](/task/test-task-19)\n
- [Test task 20 (Open)](/task/test-task-20)\n
- [Test task 21 (Open)](/task/test-task-21)\n
- [Test task 22 (Open)](/task/test-task-22)\n
- [Test task 23 (Open)](/task/test-task-23)\n
- [Test task 24 (Open)](/task/test-task-24)\n
- [Test task 25 (Open)](/task/test-task-25)\n
- [Test task 26 (Open)](/task/test-task-26)\n
- [Test task 27 (Open)](/task/test-task-27)\n
- [Test task 28 (Open)](/task/test-task-28)\n
- [Test task 29 (Open)](/task/test-task-29)\n
- [Test task 30 (Open)](/task/test-task-30)`;

    const response = await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: `${expectedResponse.length}b`,
    });
    const taskRequestParams = getApiGetTaskCollectionTasksRequestHistory().map(
        request => request.params,
    );

    expect({response, taskRequestParams}).toEqual({
        response: expectedResponse,
        taskRequestParams: [
            {
                path: {id: collectionId},
                query: {
                    limit: 31,
                    cursor: undefined,
                },
            },
        ],
    });
});

test("truncates tasks and adds a next page link when the response is over the limit", async () => {
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 4,
        limit: 31,
        createTask: index => createApiTaskMock({index, title: `Test task ${index + 1}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "160b"}))
        .toEqual(`\
# Roadmap

Color: Red

[Next page »](/task-collection/roadmap?after=f8bc90)

- [Test task 1 (Open)](/task/test-task-1)`);
});

test("adds a next page link after the name when truncating without a color", async () => {
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        totalTaskCount: 4,
        limit: 31,
        createTask: index => createApiTaskMock({index, title: `Test task ${index + 1}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "160b"}))
        .toEqual(`\
# Roadmap

[Next page »](/task-collection/roadmap?after=f8bc90)

- [Test task 1 (Open)](/task/test-task-1)`);
});

test("adds a next page link after the default filters and sorts when truncating", async () => {
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 4,
        limit: 31,
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
            sorts: [],
        },
        createTask: index => createApiTaskMock({index, title: `Test task ${index + 1}`}),
    });

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "200b"}))
        .toEqual(`\
# Roadmap

Color: Red

Default filters:

\`\`\`
status=open
\`\`\`

[Next page »](/task-collection/roadmap?after=f8bc90)

- [Test task 1 (Open)](/task/test-task-1)`);
});

test("updates the next page link cursor when truncating tasks", async () => {
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 35,
        limit: 31,
        createTask: index => createApiTaskMock({index, title: `Test task ${index + 1}`}),
    });

    const expectedTasks = Array.from(
        {length: 27},
        (_, index) => `- [Test task ${index + 1} (Open)](/task/test-task-${index + 1})`,
    ).join("\n\n");

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "1300b"}))
        .toEqual(`\
# Roadmap

Color: Red

[Next page »](/task-collection/roadmap?after=3e83d3)

${expectedTasks}`);
});

test("reads the next page of tasks with an after cursor", async () => {
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 35,
        limit: 31,
        createTask: index => createApiTaskMock({index, title: `Test task ${index + 1}`}),
    });
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 35,
        limit: 31,
        cursor: printApiTaskQueryCursorMock(26),
        createTask: index => createApiTaskMock({index, title: `Test task ${index + 1}`}),
    });

    // The first read truncates the task list and stores the full cursor for the short
    // hash printed in its "Next page »" link.
    await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "1300b"});

    expect(
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?after=3e83d3",
            limit: "10kb",
        }),
    ).toEqual(`\
Tasks in Roadmap.

- [Test task 28 (Open)](/task/test-task-28)

- [Test task 29 (Open)](/task/test-task-29)

- [Test task 30 (Open)](/task/test-task-30)

- [Test task 31 (Open)](/task/test-task-31)

- [Test task 32 (Open)](/task/test-task-32)

- [Test task 33 (Open)](/task/test-task-33)

- [Test task 34 (Open)](/task/test-task-34)

- [Test task 35 (Open)](/task/test-task-35)

End of tasks.`);
});

test("paginates through multiple pages with different task counts per page", async () => {
    // The first two tasks have much longer titles so fewer of them fit into the same
    // read limit than the later short tasks.
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 6,
        limit: 31,
        createTask: index =>
            createApiTaskMock({
                index,
                title:
                    index < 2
                        ? `Test task ${index + 1} ${"x".repeat(30)}`
                        : `Test task ${index + 1}`,
            }),
    });
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 6,
        limit: 31,
        cursor: printApiTaskQueryCursorMock(0),
        createTask: index =>
            createApiTaskMock({
                index,
                title:
                    index < 2
                        ? `Test task ${index + 1} ${"x".repeat(30)}`
                        : `Test task ${index + 1}`,
            }),
    });
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 6,
        limit: 31,
        cursor: printApiTaskQueryCursorMock(2),
        createTask: index =>
            createApiTaskMock({
                index,
                title:
                    index < 2
                        ? `Test task ${index + 1} ${"x".repeat(30)}`
                        : `Test task ${index + 1}`,
            }),
    });

    const responses = [
        await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "250b"}),
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?after=f8bc90",
            limit: "250b",
        }),
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?after=5a3649",
            limit: "250b",
        }),
    ];

    expect(responses).toEqual([
        `\
# Roadmap

Color: Red

[Next page »](/task-collection/roadmap?after=f8bc90)

- [Test task 1 ${"x".repeat(30)} (Open)](/task/test-task-1-${"x".repeat(30)})`,
        `\
Tasks in Roadmap. [Next page »](/task-collection/roadmap?after=5a3649)

- [Test task 2 ${"x".repeat(30)} (Open)](/task/test-task-2-${"x".repeat(30)})

- [Test task 3 (Open)](/task/test-task-3)`,
        `\
Tasks in Roadmap.

- [Test task 4 (Open)](/task/test-task-4)

- [Test task 5 (Open)](/task/test-task-5)

- [Test task 6 (Open)](/task/test-task-6)

End of tasks.`,
    ]);
});

test("updates the next page link cursor when truncating a later page", async () => {
    mockGetApiTaskCollectionTasks(api, {
        spaceId,
        id: collectionId,
        name: "Roadmap",
        color: "Red",
        totalTaskCount: 65,
        limit: 31,
        cursor: printApiTaskQueryCursorMock(29),
        createTask: index => createApiTaskMock({index, title: `Test task ${index + 1}`}),
    });

    // Store the full cursor for the `?after` hash like the read that printed the "Next
    // page »" link would have.
    await createAgentWebTaskQueryCursorHash(
        storage,
        `TaskCollection:${collectionId}`,
        printApiTaskQueryCursorMock(29),
    );

    const expectedTasks = Array.from(
        {length: 27},
        (_, index) => `- [Test task ${index + 31} (Open)](/task/test-task-${index + 31})`,
    ).join("\n\n");

    expect(
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?after=a3b00b",
            limit: "1300b",
        }),
    ).toEqual(`\
Tasks in Roadmap. [Next page »](/task-collection/roadmap?after=ba7c66)

${expectedTasks}`);
});

test("rejects an after cursor that is not from a next page link", async () => {
    await expect(
        callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?after=a1b2c3",
            limit: "10kb",
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t read `/task-collection/roadmap?after=a1b2c3`. " +
            ("Expected `?after` URL search param to be a cursor from a task collection " +
                "page \u201CNext page »\u201D link. Try again with a \u201CNext page »\u201D link you\u2019ve seen " +
                "before or omit `?after`."),
    );
});

test("queries a task collection with custom filters and sorts", async () => {
    const query: ApiTaskQueryDefaultsResponse = {
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
        sorts: [{type: "Priority", direction: "Descending"}],
    };
    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collectionId}},
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Roadmap",
                color: "Red",
                defaults: {filters: [], sorts: []},
            },
            nextCursor: null,
            tasks: [
                {
                    cursor: printApiTaskQueryCursorMock(0),
                    task: createApiTaskMock({index: 0, title: "Test task 1"}),
                },
            ],
        },
    });

    const response = await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap?status=open&sort=-priority",
        limit: "10kb",
    });
    const queryRequests = getApiPostTaskCollectionTasksQueryRequestHistory();

    expect({response, queryRequests}).toEqual({
        response: `\
# Roadmap

Color: Red

- [Test task 1 (Open)](/task/test-task-1)

End of tasks.`,
        queryRequests: [
            expect.objectContaining({
                params: {path: {id: collectionId}},
                body: {
                    limit: 31,
                    cursor: undefined,
                    ...query,
                },
            }),
        ],
    });
});

test("paginates custom task collection filters and sorts with after", async () => {
    const query: ApiTaskQueryDefaultsResponse = {
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
        sorts: [{type: "Priority", direction: "Descending"}],
    };
    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collectionId}},
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Roadmap",
                color: "Red",
                defaults: {filters: [], sorts: []},
            },
            nextCursor: null,
            tasks: createArrayWithLength(4, index => ({
                cursor: printApiTaskQueryCursorMock(index),
                task: createApiTaskMock({index, title: `Test task ${index + 1}`}),
            })),
        },
    });
    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collectionId}},
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Roadmap",
                color: "Red",
                defaults: {filters: [], sorts: []},
            },
            nextCursor: null,
            tasks: createArrayWithLength(3, offset => {
                const taskIndex = offset + 1;

                return {
                    cursor: printApiTaskQueryCursorMock(taskIndex),
                    task: createApiTaskMock({
                        index: taskIndex,
                        title: `Test task ${taskIndex + 1}`,
                    }),
                };
            }),
        },
    });

    const firstResponse = await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap?status=open&sort=-priority",
        limit: "200b",
    });
    const secondResponse = await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap?after=f8bc90&status=open&sort=-priority",
        limit: "10kb",
    });
    const queryRequestBodies = getApiPostTaskCollectionTasksQueryRequestHistory().map(
        request => request.body,
    );

    expect({firstResponse, secondResponse, queryRequestBodies}).toEqual({
        firstResponse: `\
# Roadmap

Color: Red

[Next page »](/task-collection/roadmap?after=f8bc90&status=open&sort=-priority)

- [Test task 1 (Open)](/task/test-task-1)`,
        secondResponse: `\
Tasks in Roadmap.

- [Test task 2 (Open)](/task/test-task-2)

- [Test task 3 (Open)](/task/test-task-3)

- [Test task 4 (Open)](/task/test-task-4)

End of tasks.`,
        queryRequestBodies: [
            {
                limit: 31,
                cursor: undefined,
                ...query,
            },
            {
                limit: 31,
                cursor: printApiTaskQueryCursorMock(0),
                ...query,
            },
        ],
    });
});

test("truncation adds a pagination link with custom filters", async () => {
    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collectionId}},
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Roadmap",
                color: "Red",
                defaults: {filters: [], sorts: []},
            },
            nextCursor: null,
            tasks: createArrayWithLength(4, index => ({
                cursor: printApiTaskQueryCursorMock(index),
                task: createApiTaskMock({index, title: `Test task ${index + 1}`}),
            })),
        },
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?priority=high",
            limit: "200b",
        }),
    ).toEqual(`\
# Roadmap

Color: Red

[Next page »](/task-collection/roadmap?after=78a797&priority=high)

- [Test task 1 (Open)](/task/test-task-1)

- [Test task 2 (Open)](/task/test-task-2)`);
});

test("truncation updates a pagination link with custom filters and sorts", async () => {
    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collectionId}},
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Roadmap",
                color: "Red",
                defaults: {filters: [], sorts: []},
            },
            nextCursor: printApiTaskQueryCursorMock(30),
            tasks: createArrayWithLength(31, index => ({
                cursor: printApiTaskQueryCursorMock(index),
                task: createApiTaskMock({index, title: `Test task ${index + 1}`}),
            })),
        },
    });

    const expectedTasks = Array.from(
        {length: 27},
        (_, index) => `- [Test task ${index + 1} (Open)](/task/test-task-${index + 1})`,
    ).join("\n\n");

    expect(
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?priority=high&sort=-created",
            limit: "1300b",
        }),
    ).toEqual(`\
# Roadmap

Color: Red

[Next page »](/task-collection/roadmap?after=3e83d3&priority=high&sort=-created)

${expectedTasks}`);
});

test("shows exactly 30 custom-query tasks when the limit is the exact response size", async () => {
    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collectionId}},
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Roadmap",
                color: "Red",
                defaults: {filters: [], sorts: []},
            },
            nextCursor: printApiTaskQueryCursorMock(30),
            tasks: createArrayWithLength(31, index => ({
                cursor: printApiTaskQueryCursorMock(index),
                task: createApiTaskMock({index, title: `Test task ${index + 1}`}),
            })),
        },
    });

    const expectedTasks = Array.from(
        {length: 30},
        (_, index) => `- [Test task ${index + 1} (Open)](/task/test-task-${index + 1})`,
    ).join("\n\n");
    const expectedResponse = `\
# Roadmap

Color: Red

[Next page »](/task-collection/roadmap?after=a3b00b&priority=high&sort=-created)

${expectedTasks}`;

    expect(
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?priority=high&sort=-created",
            limit: `${expectedResponse.length}b`,
        }),
    ).toEqual(expectedResponse);
});

test("truncation adds a pagination link with custom filters and sorts on a later page", async () => {
    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collectionId}},
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Roadmap",
                color: "Red",
                defaults: {filters: [], sorts: []},
            },
            nextCursor: null,
            tasks: createArrayWithLength(5, offset => {
                const taskIndex = offset + 30;

                return {
                    cursor: printApiTaskQueryCursorMock(taskIndex),
                    task: createApiTaskMock({
                        index: taskIndex,
                        title: `Test task ${taskIndex + 1}`,
                    }),
                };
            }),
        },
    });

    await createAgentWebTaskQueryCursorHash(
        storage,
        `TaskCollection:${collectionId}`,
        printApiTaskQueryCursorMock(29),
    );

    expect(
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?after=a3b00b&priority=high&sort=-created",
            limit: "200b",
        }),
    ).toEqual(`\
Tasks in Roadmap. [Next page »](/task-collection/roadmap?after=03dcb2&priority=high&sort=-created)

- [Test task 31 (Open)](/task/test-task-31)`);
});

test("truncation updates a pagination link with custom filters and sorts on a later page", async () => {
    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collectionId}},
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Roadmap",
                color: "Red",
                defaults: {filters: [], sorts: []},
            },
            nextCursor: printApiTaskQueryCursorMock(60),
            tasks: createArrayWithLength(31, offset => {
                const taskIndex = offset + 30;

                return {
                    cursor: printApiTaskQueryCursorMock(taskIndex),
                    task: createApiTaskMock({
                        index: taskIndex,
                        title: `Test task ${taskIndex + 1}`,
                    }),
                };
            }),
        },
    });

    await createAgentWebTaskQueryCursorHash(
        storage,
        `TaskCollection:${collectionId}`,
        printApiTaskQueryCursorMock(29),
    );

    const expectedTasks = Array.from(
        {length: 26},
        (_, index) => `- [Test task ${index + 31} (Open)](/task/test-task-${index + 31})`,
    ).join("\n\n");

    expect(
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?after=a3b00b&priority=high&sort=-created",
            limit: "1300b",
        }),
    ).toEqual(`\
Tasks in Roadmap. [Next page »](/task-collection/roadmap?after=e3e4b8&priority=high&sort=-created)

${expectedTasks}`);
});

test("rejects manual ordering with filters in search params", async () => {
    await expect(
        callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?manual&priority=high",
            limit: "10kb",
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t read `/task-collection/roadmap?manual&priority=high`. " +
            ("Can\u2019t use the `?manual` URL search param in addition to filter/sort URL " +
                "search params. Try again and either remove the `?manual` search param or " +
                "remove the filter/sort search params."),
    );
});

test("rejects manual ordering with sorts in search params", async () => {
    await expect(
        callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?manual&sort=-priority",
            limit: "10kb",
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t read `/task-collection/roadmap?manual&sort=-priority`. " +
            ("Can\u2019t use the `?manual` URL search param in addition to filter/sort URL " +
                "search params. Try again and either remove the `?manual` search param or " +
                "remove the filter/sort search params."),
    );
});

test("queries manual order with empty filters and sorts despite collection defaults", async () => {
    api.mockPost("/task-collections/{id}/tasks-query", {
        params: {path: {id: collectionId}},
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Roadmap",
                defaults: {
                    filters: [
                        {
                            type: "Priority",
                            operation: {
                                type: "OneOf",
                                priorities: [{type: "High"}],
                            },
                        },
                    ],
                    sorts: [{type: "Priority", direction: "Descending"}],
                },
            },
            nextCursor: null,
            tasks: [
                {
                    cursor: printApiTaskQueryCursorMock(0),
                    task: createApiTaskMock({index: 0}),
                },
            ],
        },
    });

    await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap?manual",
        limit: "10kb",
    });

    expect({
        getRequests: getApiGetTaskCollectionTasksRequestHistory(),
        queryRequestBodies: getApiPostTaskCollectionTasksQueryRequestHistory().map(
            request => request.body,
        ),
    }).toEqual({
        getRequests: [],
        queryRequestBodies: [
            {
                limit: 31,
                cursor: undefined,
                filters: [],
                sorts: [],
            },
        ],
    });
});
