import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {createAgentWebTaskQueryCursorHash} from "~/server/agents/web/agent_web_task_query_cursor_hash.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {agentWebTaskCollectionPageApiTasksBatchCount} from "~/server/agents/web/pages/agent_web_task_collection_page.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {
    ApiTaskCollectionColor,
    ApiTaskQueryDefaultsResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
import {AccountId, BotId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
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
    await createAgentWebPageStoredLinkPathname(storage, context.botAccount);
    await createAgentWebPageStoredLinkPathname(storage, {
        type: "TaskCollection",
        id: collectionId,
        title: "Roadmap",
    });
});

function mockGetCollectionTasks({
    cursor,
    totalTaskCount,
    color = "Red",
    defaults = {filters: [], sorts: []},
    getTitle = getTaskTitle,
}: {
    cursor?: ApiTaskQueryCursor;
    totalTaskCount: number;
    color?: ApiTaskCollectionColor | null;
    defaults?: ApiTaskQueryDefaultsResponse;
    getTitle?: (index: number) => string;
}) {
    const startIndex =
        cursor === undefined ? 0 : parseInt(cursor.slice("task-cursor-".length), 10) + 1;
    const endIndex = Math.min(
        startIndex + agentWebTaskCollectionPageApiTasksBatchCount - 1,
        totalTaskCount - 1,
    );
    const returnedTaskCount = Math.max(endIndex - startIndex + 1, 0);

    api.mockGet("/task-collections/{id}/tasks", {
        params: {
            path: {id: collectionId},
            query: {
                limit: agentWebTaskCollectionPageApiTasksBatchCount,
                cursor,
            },
        },
        data: {
            spaceId,
            collection: {
                id: collectionId,
                name: "Roadmap",
                ...(color !== null ? {color} : {}),
                defaults,
            },
            nextCursor: endIndex < totalTaskCount - 1 ? getTaskQueryCursor(endIndex) : null,
            tasks: Array.from({length: returnedTaskCount}, (_, index) => {
                const taskIndex = startIndex + index;

                return {
                    cursor: getTaskQueryCursor(taskIndex),
                    task: {
                        id: getTaskId(taskIndex),
                        title: getTitle(taskIndex),
                        status: {type: "Open" as const, isActive: false},
                    },
                };
            }),
        },
    });
}

function getTaskQueryCursor(index: number): ApiTaskQueryCursor {
    return `task-cursor-${index}` as ApiTaskQueryCursor;
}

// A task's id must be stable across mocks like the real API so reads of later
// pages reuse the pathnames stored by earlier reads for the same task.
const taskIdsByIndex = new Map<number, TaskId>();

function getTaskId(index: number): TaskId {
    let id = taskIdsByIndex.get(index);

    if (id === undefined) {
        id = generateId<TaskId>();
        taskIdsByIndex.set(index, id);
    }

    return id;
}

function getTaskTitle(index: number): string {
    return `Test task ${index + 1}`;
}

test("reads a task collection page with tasks", async () => {
    mockGetCollectionTasks({totalTaskCount: 2});

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

    api.mockGet("/task-collections/{id}/tasks", {
        params: {
            path: {id: collectionId},
            query: {
                limit: agentWebTaskCollectionPageApiTasksBatchCount,
                cursor: undefined,
            },
        },
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
                    cursor: getTaskQueryCursor(0),
                    task: {
                        id: generateId<TaskId>(),
                        title: "Write spec",
                        status: {type: "Open", isActive: false},
                        parent: {
                            task: {
                                id: generateId<TaskId>(),
                                title: "Plan launch",
                                status: {type: "Open", isActive: false},
                            },
                        },
                        assignee: aliceAccount,
                        collections: [
                            {collection: roadmapCollection},
                            {collection: engineeringCollection},
                            {collection: designCollection},
                            {collection: growthCollection},
                            {collection: marketingCollection},
                        ],
                        priority: {type: "High"},
                        due: {date: "2027-07-12"},
                    },
                },
                {
                    cursor: getTaskQueryCursor(1),
                    task: {
                        id: generateId<TaskId>(),
                        title: "Review spec",
                        status: {type: "Open", isActive: false},
                        collections: [
                            {collection: roadmapCollection},
                            {collection: engineeringCollection},
                            {collection: designCollection},
                            {collection: growthCollection},
                        ],
                        priority: {type: "Low"},
                    },
                },
                {
                    cursor: getTaskQueryCursor(2),
                    task: {
                        id: generateId<TaskId>(),
                        title: "Ship launch",
                        status: {type: "Closed"},
                        collections: [{collection: roadmapCollection}],
                    },
                },
            ],
        },
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
    api.mockGet("/task-collections/{id}/tasks", {
        params: {
            path: {id: collectionId},
            query: {
                limit: agentWebTaskCollectionPageApiTasksBatchCount,
                cursor: undefined,
            },
        },
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
                    cursor: getTaskQueryCursor(0),
                    task: {
                        id: generateId<TaskId>(),
                        title: "Write spec",
                        status: {type: "Open", isActive: false},
                        priority: {type: "High"},
                    },
                },
                {
                    cursor: getTaskQueryCursor(1),
                    task: {
                        id: generateId<TaskId>(),
                        title: "Ship launch",
                        status: {type: "Open", isActive: false},
                        priority: {type: "Low"},
                    },
                },
            ],
        },
    });

    const expectedResponse = `\
# Roadmap

Color: Red

[Next page »](/task-collection/roadmap?after=f55706)

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
    mockGetCollectionTasks({totalTaskCount: 1, color: null});

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "10kb"}))
        .toEqual(`\
# Roadmap

- [Test task 1 (Open)](/task/test-task-1)

End of tasks.`);
});

test("reads a task collection page with default filters and sorts", async () => {
    mockGetCollectionTasks({
        totalTaskCount: 1,
        defaults: {
            filters: [
                {
                    type: "Status",
                    operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
                },
            ],
            sorts: [
                {type: "Priority", direction: "Descending"},
                {type: "Due", direction: "Ascending"},
            ],
        },
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
    mockGetCollectionTasks({
        cursor: getTaskQueryCursor(29),
        totalTaskCount: 35,
        defaults: {
            filters: [
                {
                    type: "Status",
                    operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
                },
            ],
            sorts: [],
        },
    });

    // Store the full cursor for the `?after` hash like the read that printed the "Next
    // page »" link would have.
    await createAgentWebTaskQueryCursorHash(storage, collectionId, getTaskQueryCursor(29));

    expect(
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?after=ee09e6",
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
    mockGetCollectionTasks({totalTaskCount: 0});

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "10kb"}))
        .toEqual(`\
# Roadmap

Color: Red

End of tasks.`);
});

test("loads more task pages while the response is still under the limit", async () => {
    mockGetCollectionTasks({totalTaskCount: 35});
    mockGetCollectionTasks({cursor: getTaskQueryCursor(29), totalTaskCount: 35});

    const response = await callAgentWebReadTool(context, {
        path: "/task-collection/roadmap",
        limit: "10kb",
    });
    const taskRequestParams = api
        .getRequestHistory()
        .filter(
            request => request.method === "GET" && request.path === "/task-collections/{id}/tasks",
        )
        .map(request => request.params);

    expect({response, taskRequestParams}).toEqual({
        taskRequestParams: [
            {
                path: {id: collectionId},
                query: {
                    limit: agentWebTaskCollectionPageApiTasksBatchCount,
                    cursor: undefined,
                },
            },
            {
                path: {id: collectionId},
                query: {
                    limit: agentWebTaskCollectionPageApiTasksBatchCount,
                    cursor: getTaskQueryCursor(29),
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
    mockGetCollectionTasks({totalTaskCount: 35});

    const expectedResponse = `\
# Roadmap

Color: Red

[Next page »](/task-collection/roadmap?after=ee09e6)\n
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
    const taskRequestParams = api
        .getRequestHistory()
        .filter(
            request => request.method === "GET" && request.path === "/task-collections/{id}/tasks",
        )
        .map(request => request.params);

    expect({response, taskRequestParams}).toEqual({
        response: expectedResponse,
        taskRequestParams: [
            {
                path: {id: collectionId},
                query: {
                    limit: agentWebTaskCollectionPageApiTasksBatchCount,
                    cursor: undefined,
                },
            },
        ],
    });
});

test("truncates tasks and adds a next page link when the response is over the limit", async () => {
    mockGetCollectionTasks({totalTaskCount: 4});

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "160b"}))
        .toEqual(`\
# Roadmap

Color: Red

[Next page »](/task-collection/roadmap?after=f55706)

- [Test task 1 (Open)](/task/test-task-1)`);
});

test("adds a next page link after the name when truncating without a color", async () => {
    mockGetCollectionTasks({totalTaskCount: 4, color: null});

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "160b"}))
        .toEqual(`\
# Roadmap

[Next page »](/task-collection/roadmap?after=f55706)

- [Test task 1 (Open)](/task/test-task-1)`);
});

test("adds a next page link after the default filters and sorts when truncating", async () => {
    mockGetCollectionTasks({
        totalTaskCount: 4,
        defaults: {
            filters: [
                {
                    type: "Status",
                    operation: {type: "OneOf", statuses: [{type: "Open", isActive: false}]},
                },
            ],
            sorts: [],
        },
    });

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "200b"}))
        .toEqual(`\
# Roadmap

Color: Red

Default filters:

\`\`\`
status=open
\`\`\`

[Next page »](/task-collection/roadmap?after=f55706)

- [Test task 1 (Open)](/task/test-task-1)`);
});

test("updates the next page link cursor when truncating tasks", async () => {
    mockGetCollectionTasks({totalTaskCount: 35});

    const expectedTasks = Array.from(
        {length: 27},
        (_, index) => `- [Test task ${index + 1} (Open)](/task/test-task-${index + 1})`,
    ).join("\n\n");

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "1300b"}))
        .toEqual(`\
# Roadmap

Color: Red

[Next page »](/task-collection/roadmap?after=a2c595)

${expectedTasks}`);
});

test("reads the next page of tasks with an after cursor", async () => {
    mockGetCollectionTasks({totalTaskCount: 35});
    mockGetCollectionTasks({cursor: getTaskQueryCursor(26), totalTaskCount: 35});

    // The first read truncates the task list and stores the full cursor for the short
    // hash printed in its "Next page »" link.
    await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "1300b"});

    expect(
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?after=a2c595",
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
    const getTitle = (index: number) =>
        index < 2 ? `${getTaskTitle(index)} ${"x".repeat(30)}` : getTaskTitle(index);

    mockGetCollectionTasks({totalTaskCount: 6, getTitle});
    mockGetCollectionTasks({cursor: getTaskQueryCursor(0), totalTaskCount: 6, getTitle});
    mockGetCollectionTasks({cursor: getTaskQueryCursor(2), totalTaskCount: 6, getTitle});

    const responses = [
        await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "250b"}),
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?after=f55706",
            limit: "250b",
        }),
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?after=5a93b4",
            limit: "250b",
        }),
    ];

    expect(responses).toEqual([
        `\
# Roadmap

Color: Red

[Next page »](/task-collection/roadmap?after=f55706)

- [Test task 1 ${"x".repeat(30)} (Open)](/task/test-task-1-${"x".repeat(30)})`,
        `\
Tasks in Roadmap. [Next page »](/task-collection/roadmap?after=5a93b4)

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
    mockGetCollectionTasks({cursor: getTaskQueryCursor(29), totalTaskCount: 65});

    // Store the full cursor for the `?after` hash like the read that printed the "Next
    // page »" link would have.
    await createAgentWebTaskQueryCursorHash(storage, collectionId, getTaskQueryCursor(29));

    const expectedTasks = Array.from(
        {length: 27},
        (_, index) => `- [Test task ${index + 31} (Open)](/task/test-task-${index + 31})`,
    ).join("\n\n");

    expect(
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?after=ee09e6",
            limit: "1300b",
        }),
    ).toEqual(`\
Tasks in Roadmap. [Next page »](/task-collection/roadmap?after=e32af4)

${expectedTasks}`);
});

test("rejects an after cursor that is not from a next page link", async () => {
    await expect(
        callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?after=a1b2c3",
            limit: "10kb",
        }),
    ).rejects.toThrow("Expected `after` search param to be a cursor");
});

test("ignores task collection search parameters other than after", async () => {
    mockGetCollectionTasks({totalTaskCount: 1});

    expect(
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?status=open",
            limit: "10kb",
        }),
    ).toEqual(`\
# Roadmap

Color: Red

- [Test task 1 (Open)](/task/test-task-1)

End of tasks.`);
});
