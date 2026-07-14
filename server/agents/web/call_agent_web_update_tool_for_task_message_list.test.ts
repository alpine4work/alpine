import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {createApiMessageMock} from "~/server/agents/api/test_helpers/create_api_message_mock.js";
import {mockApiGetTaskMessages} from "~/server/agents/api/test_helpers/mock_api_get_task_messages.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {ApiTaskReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ErrorBase, InternalError} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

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

const taskReference: ApiTaskReferenceResponse = {
    type: "Task",
    id: taskId,
    title: "Write Spec",
    status: {type: "Open", isActive: true},
};

const otherTaskReference: ApiTaskReferenceResponse = {
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
        type: "Account",
        id: botAccountId,
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: {id: botId},
        pathname: "/bot/chatgpt",
    },
};

beforeEach(async () => {
    const actualBotAccountPathname = await createAgentWebPageStoredLinkPathname(
        storage,
        context.botAccount,
    );
    assert(actualBotAccountPathname === context.botAccount.pathname);

    const actualTaskPathname = await createAgentWebPageStoredLinkPathname(storage, taskReference);
    assert(actualTaskPathname === taskPath);

    const actualOtherTaskPathname = await createAgentWebPageStoredLinkPathname(
        storage,
        otherTaskReference,
    );
    assert(actualOtherTaskPathname === otherTaskPath);
});

function createTextContent(text: string): ApiContentResponseWithoutKeys {
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

function printDisplayMessage(displayMessage: ErrorDisplayMessage): string {
    let string = "";

    for (const segment of displayMessage) {
        switch (segment.type) {
            case "Text":
            case "SensitiveText":
            case "Link": {
                string += segment.text;
                break;
            }
            default:
                throw exhaustive(segment);
        }
    }

    return string;
}

function getDisplayMessage(error: unknown): ErrorDisplayMessage {
    if (error instanceof ErrorBase && error.displayMessage) {
        return error.displayMessage;
    }

    if (error instanceof AggregateError) {
        for (const childError of error.errors) {
            if (childError instanceof ErrorBase && childError.displayMessage) {
                return childError.displayMessage;
            }
        }
    }

    throw error;
}

async function expectUpdateDisplayMessage({
    path,
    updates,
    expected,
}: {
    path: string;
    updates: Parameters<typeof callAgentWebUpdateTool>[1]["updates"];
    expected: string;
}) {
    let error: unknown;

    try {
        await callAgentWebUpdateTool(context, {path, updates});
    } catch (actualError) {
        error = actualError;
    }

    if (!error) throw new InternalError("Expected update tool call to throw");

    expect(printDisplayMessage(getDisplayMessage(error))).toEqual(expected);
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
    ).resolves.toEqual("Update was successful.\n");

    expect(getCreateTaskCommentRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("First bot comment."),
        },
    ]);
});

test("rejects changing the task in the preamble", async () => {
    await readTaskComments();

    await expectUpdateDisplayMessage({
        path: taskCommentsPath,
        updates: [
            {
                old: "Comments on [Write Spec (Open, active)](/task/write-spec).",
                new: "Comments on [Review Spec (Open, active)](/task/review-spec).",
                replaceAll: false,
            },
        ],
        expected:
            "You can only update your `<comment>`s. You can\u2019t change which task the comments belong to on line 1. Try again with a more specific update that only changes the content of comments from you or adds new comments.",
    });

    expect(getCreateTaskCommentRequests()).toHaveLength(0);
});
