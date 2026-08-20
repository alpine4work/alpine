import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {createApiMessageMock} from "~/server/agents/api/test_helpers/create_api_message_mock.js";
import {mockApiGetTaskMessages} from "~/server/agents/api/test_helpers/mock_api_get_task_messages.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebReadTool as actuallyCallAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {callAgentWebUpdateTool as actuallyCallAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {
    ApiContentWithoutKeys,
    ApiTaskReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";
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
const taskId = generateId<TaskId>();
const otherTaskId = generateId<TaskId>();
const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();

const botApiAccount = createApiAccountMock({
    id: botAccountId,
    name: "ChatGPT",
    botId,
});

const taskReference: ApiTaskReference = {
    type: "Task",
    id: taskId,
    title: "Write Spec",
    status: {type: "Open", isActive: true},
};

const otherTaskReference: ApiTaskReference = {
    type: "Task",
    id: otherTaskId,
    title: "Review Spec",
    status: {type: "Open", isActive: true},
};

const taskPath = "/task/write-spec";
const taskCommentsPath = "/task/write-spec/comments";
const otherTaskPath = "/task/review-spec";

const {span} = testTracer.startSpan("call_agent_web_update_tool_task_message_list.test.ts");
const api = new ApiClientMock();
const storage = createAgentWebSessionStorageForTest(spaceId);

const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        id: botAccountId,
        bot: {id: botId},
    },
};

beforeEach(async () => {
    const actualBotAccountPathname = await storeAgentWebPageLinkForTest(storage, {
        type: "Account",
        id: context.botAccount.id,
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: context.botAccount.bot,
    });
    assert(actualBotAccountPathname === "/bot/chatgpt");

    const actualTaskPathname = await storeAgentWebPageLinkForTest(storage, taskReference);
    assert(actualTaskPathname === taskPath);

    const actualOtherTaskPathname = await storeAgentWebPageLinkForTest(storage, otherTaskReference);
    assert(actualOtherTaskPathname === otherTaskPath);
});

function createTextContent(text: string): ApiContentWithoutKeys {
    return {
        elements: [{type: "Paragraph", elements: [{type: "Text", text}]}],
    };
}

function mockApiGetTaskReference() {
    api.mockGet("/tasks/{id}-reference", {
        params: {path: {id: taskId}},
        data: {spaceId, reference: taskReference},
    });
}

async function readTaskComments() {
    mockApiGetTaskReference();
    mockApiGetTaskMessages(api, {
        spaceId,
        taskId,
        totalMessageCount: 0,
        limit: 30,
        createMessage: index => createApiMessageMock({index, author: botApiAccount}),
    });

    return await callAgentWebReadTool(context, {path: taskCommentsPath, limit: "10kb"});
}

function mockCreateTaskComment({index}: {index: number}) {
    api.mockPost("/tasks/{id}/messages", {
        params: {path: {id: taskId}},
        data: {
            spaceId,
            message: createApiMessageMock({
                index,
                author: botApiAccount,
                content: "Created comment response",
            }),
        },
    });
}

function getCreateTaskCommentRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "POST" && request.path === "/tasks/{id}/messages");
}

test("adds a task comment", async () => {
    await readTaskComments();
    mockCreateTaskComment({index: 0});

    await expect(
        callAgentWebUpdateTool(context, {
            path: taskCommentsPath,
            updates: [
                {
                    old: "\n\nEnd of comments.",
                    new: '\n\n<comment from="[ChatGPT](/bot/chatgpt)">\n\nFirst bot comment.\n\n</comment>\n\nEnd of comments.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateTaskCommentRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("First bot comment."),
            createdTimeZone: defaultTimeZone,
        },
    ]);
});

test("rejects changing the task in the preamble", async () => {
    await readTaskComments();

    await expect(
        callAgentWebUpdateTool(context, {
            path: taskCommentsPath,
            updates: [
                {
                    old: "Comments on [Write Spec (Open, active)](/task/write-spec).",
                    new: "Comments on [Review Spec (Open, active)](/task/review-spec).",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/task/write-spec/comments`. " +
            "You can only update your `<comment>`s. You can\u2019t change which task the comments belong to on line 1. Try again with a more specific update that only changes the content of comments from you or adds new comments.",
    );

    expect(getCreateTaskCommentRequests()).toHaveLength(0);
});
