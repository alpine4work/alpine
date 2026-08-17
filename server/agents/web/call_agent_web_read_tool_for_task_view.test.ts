import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiTaskMock} from "~/server/agents/api/test_helpers/create_api_task_mock.js";
import {printApiTaskQueryCursorMock} from "~/server/agents/api/test_helpers/mock_api_get_task_collection_tasks.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {createAgentWebTaskQueryCursorHash} from "~/server/agents/web/agent_web_task_query_cursor_hash.open_source.js";
import {callAgentWebReadTool as actuallyCallAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiTaskQueryDefaultsResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

async function callAgentWebReadTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebReadTool>
): Promise<string> {
    const result = await actuallyCallAgentWebReadTool(...callArguments);
    assert(result.response.type === "String");
    return result.response.string;
}

const spaceId = generateId<SpaceId>();
const {span} = testTracer.startSpan("call_agent_web_read_tool_for_task_view.test.ts");
const api = new ApiClientMock();
const storage = createAgentWebSessionStorageForTest(spaceId);
const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        id: generateId<AccountId>(),
        bot: {id: generateId<BotId>()},
    },
};

beforeEach(async () => {
    await storage.deleteAll();
});

function getApiPostUntitledTaskViewQueryRequestHistory() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "POST" && request.path === "/tasks-query");
}

test("reads a filtered and sorted task view", async () => {
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

    api.mockPost("/tasks-query", {
        params: "Any",
        data: {
            spaceId,
            nextCursor: null,
            tasks: [
                {
                    cursor: printApiTaskQueryCursorMock(0),
                    task: createApiTaskMock({index: 0, title: "Write spec"}),
                },
            ],
        },
    });

    const response = await callAgentWebReadTool(context, {
        path: "/task-view?status=open&sort=-priority",
        limit: "10kb",
    });

    expect({response, requests: getApiPostUntitledTaskViewQueryRequestHistory()}).toEqual({
        response: `\
# Untitled

- [Write spec (Open)](/task/write-spec)

End of tasks.`,
        requests: [
            expect.objectContaining({
                body: {
                    spaceId,
                    limit: 31,
                    cursor: undefined,
                    ...query,
                },
            }),
        ],
    });
});

test("paginates a filtered and sorted task view", async () => {
    const query: ApiTaskQueryDefaultsResponse = {
        filters: [],
        sorts: [{type: "CreatedTime", direction: "Descending"}],
    };
    const firstTasks = createArrayWithLength(4, index => ({
        cursor: printApiTaskQueryCursorMock(index),
        task: createApiTaskMock({index, title: `Task ${index + 1}`}),
    }));
    const afterCursor = firstTasks[0]!.cursor;
    const afterCursorHash = await createAgentWebTaskQueryCursorHash(
        storage,
        "TaskView",
        afterCursor,
    );

    api.mockPost("/tasks-query", {
        params: "Any",
        data: {spaceId, nextCursor: null, tasks: firstTasks},
    });
    api.mockPost("/tasks-query", {
        params: "Any",
        data: {spaceId, nextCursor: null, tasks: firstTasks.slice(1)},
    });

    const firstResponse = await callAgentWebReadTool(context, {
        path: "/task-view?sort=-created",
        limit: "140b",
    });
    const secondResponse = await callAgentWebReadTool(context, {
        path: `/task-view?after=${afterCursorHash}&sort=-created`,
        limit: "10kb",
    });

    expect({
        firstResponse,
        secondResponse,
        requestBodies: getApiPostUntitledTaskViewQueryRequestHistory().map(request => request.body),
    }).toEqual({
        firstResponse: `\
# Untitled

[Next page »](/task-view?after=${afterCursorHash}&sort=-created)

- [Task 1 (Open)](/task/task-1)`,
        secondResponse: `\
# Untitled

- [Task 2 (Open)](/task/task-2)

- [Task 3 (Open)](/task/task-3)

- [Task 4 (Open)](/task/task-4)

End of tasks.`,
        requestBodies: [
            {spaceId, limit: 31, cursor: undefined, ...query},
            {spaceId, limit: 31, cursor: afterCursor, ...query},
        ],
    });
});

test("rejects an unknown task view cursor hash", async () => {
    await expect(
        callAgentWebReadTool(context, {path: "/task-view?after=a1b2c3", limit: "10kb"}),
    ).resolves.toEqual(
        "Error: Couldn\u2019t read `/task-view?after=a1b2c3`. " +
            ("Expected `?after` URL search param to be a cursor from a task view page " +
                "\u201CNext page »\u201D link. Try again with a \u201CNext page »\u201D link you\u2019ve seen " +
                "before or omit `?after`."),
    );
});
