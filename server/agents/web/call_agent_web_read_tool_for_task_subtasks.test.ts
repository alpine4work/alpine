import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {
    createApiTaskIdMock,
    createApiTaskMock,
} from "~/server/agents/api/test_helpers/create_api_task_mock.js";
import {printApiTaskQueryCursorMock} from "~/server/agents/api/test_helpers/mock_api_get_task_collection_tasks.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebReadTool as actuallyCallAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {
    ApiTaskResponse,
    ApiTaskWithNotesResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {omitObject} from "~/shared/helpers/object/omit_object.open_source.js";
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
const parentTask = createApiTaskMock({id: createApiTaskIdMock(100), title: "My Task"});
const {span} = testTracer.startSpan("call_agent_web_read_tool_for_task_subtasks.test.ts");
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

function withoutNotes(task: ApiTaskResponse | ApiTaskWithNotesResponse): ApiTaskResponse {
    if (!("notes" in task)) return task;

    return omitObject(task, ["notes"]);
}

beforeEach(async () => {
    await storage.deleteAll();
    await storeAgentWebPageLinkForTest(storage, [
        {
            type: "Account",
            id: context.botAccount.id,
            title: "ChatGPT",
            shortName: "ChatGPT",
            bot: context.botAccount.bot,
        },
        parentTask,
    ]);
});

test("reads task subtasks with the parent task preamble", async () => {
    const firstSubtask = createApiTaskMock({
        index: 0,
        title: "First subtask",
        parent: parentTask,
        layout: "Project",
        priority: "High",
    });
    const secondSubtask = createApiTaskMock({
        index: 1,
        title: "Second subtask",
        parent: parentTask,
        status: "Closed",
    });

    api.mockGet("/tasks/{id}/subtasks", {
        params: {path: {id: parentTask.id}, query: {limit: 31, cursor: undefined}},
        data: {
            spaceId,
            task: withoutNotes(parentTask),
            nextCursor: null,
            tasks: [
                {cursor: printApiTaskQueryCursorMock(0), task: withoutNotes(firstSubtask)},
                {cursor: printApiTaskQueryCursorMock(1), task: withoutNotes(secondSubtask)},
            ],
        },
    });

    await expect(callAgentWebReadTool(context, {path: "/task/my-task/subtasks", limit: "10kb"}))
        .resolves.toEqual(`\
Subtasks for [My Task (Open)](/task/my-task).

- [First subtask (Open)](/task/first-subtask)
  - Priority: High

- [Second subtask (Closed)](/task/second-subtask)

End of tasks.`);
});

test("queries task subtasks with URL filters and sorts", async () => {
    const subtask = createApiTaskMock({index: 0, title: "Urgent subtask", parent: parentTask});

    api.mockPost("/tasks/{id}/subtasks-query", {
        params: {path: {id: parentTask.id}},
        data: {
            spaceId,
            task: withoutNotes(parentTask),
            nextCursor: null,
            tasks: [{cursor: printApiTaskQueryCursorMock(0), task: withoutNotes(subtask)}],
        },
    });

    const response = await callAgentWebReadTool(context, {
        path: "/task/my-task/subtasks?status=open&sort=-priority",
        limit: "10kb",
    });
    const request = api
        .getRequestHistory()
        .find(request => request.path === "/tasks/{id}/subtasks-query");

    expect({response, body: request?.body}).toEqual({
        response: `\
Subtasks for [My Task (Open)](/task/my-task).

- [Urgent subtask (Open)](/task/urgent-subtask)

End of tasks.`,
        body: {
            limit: 31,
            cursor: undefined,
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
        },
    });
});

test("paginates task subtasks with the same preamble on every page", async () => {
    const firstSubtask = createApiTaskMock({index: 0, title: "First subtask", parent: parentTask});
    const secondSubtask = createApiTaskMock({
        index: 1,
        title: "Second subtask",
        parent: parentTask,
    });
    const expectedFirstPage = `\
Subtasks for [My Task (Open)](/task/my-task). [Next page »](/task/my-task/subtasks?after=f8bc90)

- [First subtask (Open)](/task/first-subtask)`;

    api.mockGet("/tasks/{id}/subtasks", {
        params: {path: {id: parentTask.id}, query: {limit: 31, cursor: undefined}},
        data: {
            spaceId,
            task: withoutNotes(parentTask),
            nextCursor: printApiTaskQueryCursorMock(1),
            tasks: [
                {cursor: printApiTaskQueryCursorMock(0), task: withoutNotes(firstSubtask)},
                {cursor: printApiTaskQueryCursorMock(1), task: withoutNotes(secondSubtask)},
            ],
        },
    });
    api.mockGet("/tasks/{id}/subtasks", {
        params: {
            path: {id: parentTask.id},
            query: {limit: 31, cursor: printApiTaskQueryCursorMock(0)},
        },
        data: {
            spaceId,
            task: withoutNotes(parentTask),
            nextCursor: null,
            tasks: [{cursor: printApiTaskQueryCursorMock(1), task: withoutNotes(secondSubtask)}],
        },
    });

    const firstPage = await callAgentWebReadTool(context, {
        path: "/task/my-task/subtasks",
        limit: `${expectedFirstPage.length}b`,
    });
    const secondPage = await callAgentWebReadTool(context, {
        path: "/task/my-task/subtasks?after=f8bc90",
        limit: "10kb",
    });

    expect({firstPage, secondPage}).toEqual({
        firstPage: expectedFirstPage,
        secondPage: `\
Subtasks for [My Task (Open)](/task/my-task).

- [Second subtask (Open)](/task/second-subtask)

End of tasks.`,
    });
});
