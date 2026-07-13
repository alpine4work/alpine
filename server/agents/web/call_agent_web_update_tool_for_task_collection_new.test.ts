import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiTaskMock} from "~/server/agents/api/test_helpers/create_api_task_mock.js";
import {
    mockGetApiTaskCollectionTasks,
    printApiTaskQueryCursorMock,
} from "~/server/agents/api/test_helpers/mock_api_get_task_collection_tasks.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();

const {span} = testTracer.startSpan("call_agent_web_update_tool_for_task_collection.test.ts");
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

test("adds a task at the end of a manually ordered collection", async () => {
    const {collection} = mockGetApiTaskCollectionTasks(api, {
        spaceId,
        totalTaskCount: 2,
        limit: 31,
        createTask: index => createApiTaskMock({index}),
    });

    const newTask = createApiTaskMock({index: 2});

    api.mockPatch("/tasks", {
        params: "Any",
        data: {
            tasks: [
                {
                    task: newTask,
                    collections: [{movedCursor: printApiTaskQueryCursorMock(2), collection}],
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
    ).resolves.toEqual("Update was successful.\n");

    expect(
        api
            .getRequestHistory()
            .filter(request => request.method === "PATCH" && request.path === "/tasks")
            .map(({body}) => body),
    ).toMatchObject([
        {
            patches: [
                {
                    id: newTask.id,
                    patch: {
                        type: "AddCollection",
                        item: {
                            collection: {
                                type: "TaskCollection",
                                id: collection.id,
                            },
                        },
                    },
                },
                {
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
