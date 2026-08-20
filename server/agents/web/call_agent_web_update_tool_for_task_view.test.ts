import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiTaskMock} from "~/server/agents/api/test_helpers/create_api_task_mock.js";
import {printApiTaskQueryCursorMock} from "~/server/agents/api/test_helpers/mock_api_get_task_collection_tasks.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebReadTool as actuallyCallAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {callAgentWebUpdateTool as actuallyCallAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiTask} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
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

async function callAgentWebUpdateTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebUpdateTool>
): Promise<string> {
    return (await actuallyCallAgentWebUpdateTool(...callArguments)).response;
}

const spaceId = generateId<SpaceId>();
const {span} = testTracer.startSpan("call_agent_web_update_tool_for_task_view.test.ts");
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

function mockTaskView(tasks: ReadonlyArray<ApiTask>, path = "/task-view"): string {
    api.mockPost("/tasks-query", {
        params: "Any",
        data: {
            spaceId,
            nextCursor: null,
            tasks: tasks.map((task, index) => ({
                cursor: printApiTaskQueryCursorMock(index),
                task,
            })),
        },
    });

    return path;
}

function getApiPatchTasksRequestHistory() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "PATCH" && request.path === "/tasks")
        .map(({body}) => body);
}

test("updates a task in a task view", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1, priority: "High"});
    const path = mockTaskView([task1, task2], "/task-view?sort=-priority");

    api.mockPatch("/tasks", {
        params: "Any",
        data: {
            spaceId,
            tasks: [{...task2, priority: {type: "Low"}}],
            results: [
                {
                    type: "Update",
                    result: {type: "SetPriority"},
                },
            ],
        },
    });

    await callAgentWebReadTool(context, {path, limit: "50kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
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

test("rejects moving a task in a task view", async () => {
    const task1 = createApiTaskMock({index: 0});
    const task2 = createApiTaskMock({index: 1});
    const path = mockTaskView([task1, task2], "/task-view?sort=created");

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
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-view?sort=created`. Can\u2019t reorder tasks in task view " +
            ("markdown because the view is always automatically sorted. To move a task, update " +
                "a field used by the view\u2019s `sort` URL search param (defaults to `sort=created` " +
                "if not present), then call the `read` tool again to see the updated order. Try " +
                "again without reordering tasks."),
    );

    expect(getApiPatchTasksRequestHistory()).toEqual([]);
});

test("rejects removing a task from a task view", async () => {
    const task = createApiTaskMock({index: 0});
    const path = mockTaskView([task], "/task-view?priority=high");

    await callAgentWebReadTool(context, {path, limit: "50kb"});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "\n\n- [Test Task 0 (Open)](/task/test-task-0)",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task-view?priority=high`. Can\u2019t remove tasks from task view " +
            ("markdown because the view\u2019s tasks are selected by its URL search param filters. " +
                "Try updating a task\u2019s fields so they no longer match the filters, then call " +
                "the `read` tool again to see the updated view."),
    );

    expect(getApiPatchTasksRequestHistory()).toEqual([]);
});
