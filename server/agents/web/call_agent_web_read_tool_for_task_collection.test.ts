import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {agentWebTaskCollectionPageApiTasksBatchCount} from "~/server/agents/web/pages/agent_web_task_collection_page.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiTaskCollectionColor} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_cursors.js";
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
}: {
    cursor?: ApiTaskQueryCursor;
    totalTaskCount: number;
    color?: ApiTaskCollectionColor | null;
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
                defaults: {filters: [], sorts: []},
            },
            nextCursor: endIndex < totalTaskCount - 1 ? getTaskQueryCursor(endIndex) : null,
            tasks: Array.from({length: returnedTaskCount}, (_, index) => {
                const taskIndex = startIndex + index;

                return {
                    id: generateId<TaskId>(),
                    title: getTaskTitle(taskIndex),
                    status: {type: "Open" as const, isActive: false},
                };
            }),
        },
    });
}

function getTaskQueryCursor(index: number): ApiTaskQueryCursor {
    return `task-cursor-${index}` as ApiTaskQueryCursor;
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

- [Test task 2 (Open)](/task/test-task-2)`);
});

test("reads a task collection page without a color", async () => {
    mockGetCollectionTasks({totalTaskCount: 1, color: null});

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "10kb"}))
        .toEqual(`\
# Roadmap

- [Test task 1 (Open)](/task/test-task-1)`);
});

test("reads a task collection page without tasks", async () => {
    mockGetCollectionTasks({totalTaskCount: 0});

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "10kb"}))
        .toEqual(`\
# Roadmap

Color: Red`);
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
- [Test task 35 (Open)](/task/test-task-35)`,
    });
});

test("does not load more or truncate when the response is exactly at the limit", async () => {
    mockGetCollectionTasks({totalTaskCount: 35});

    const expectedResponse = `\
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

test("truncates tasks when the response is over the limit", async () => {
    mockGetCollectionTasks({totalTaskCount: 4});

    expect(await callAgentWebReadTool(context, {path: "/task-collection/roadmap", limit: "160b"}))
        .toEqual(`\
# Roadmap

Color: Red

- [Test task 1 (Open)](/task/test-task-1)

- [Test task 2 (Open)](/task/test-task-2)

- [Test task 3 (Open)](/task/test-task-3)`);
});

test("ignores task collection search parameters", async () => {
    mockGetCollectionTasks({totalTaskCount: 1});

    expect(
        await callAgentWebReadTool(context, {
            path: "/task-collection/roadmap?after=task-cursor-0&status=open",
            limit: "10kb",
        }),
    ).toEqual(`\
# Roadmap

Color: Red

- [Test task 1 (Open)](/task/test-task-1)`);
});
