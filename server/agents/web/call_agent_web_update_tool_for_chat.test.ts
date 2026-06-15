import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {
    ApiMessageMockParent,
    createApiMessageMock,
} from "~/server/agents/api/test_helpers/create_api_message_mock.js";
import {mockApiGetChat} from "~/server/agents/api/test_helpers/mock_api_get_chat.js";
import {mockApiGetChatMessages} from "~/server/agents/api/test_helpers/mock_api_get_chat_messages.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {
    ApiAccount,
    ApiContentResponse,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    ErrorBase,
    InternalError,
    InvalidArgumentError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {UrlPath} from "~/shared/helpers/http/url_path.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const chatId = generateId<ChatId>();
const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();

const aliceAccount = createApiAccountMock({name: "Alice"});
const bobAccount = createApiAccountMock({name: "Bob"});

const {span} = testTracer.startSpan("call_agent_web_update_tool_chat.test.ts");
const api = new ApiClientMock();
const storage = createAgentWebSessionStorageForTest(spaceId);

const chatPath = "/chat/incident-response";

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

    const chatPathname = await createAgentWebPageStoredLinkPathname(storage, {
        type: "Chat",
        id: chatId,
        title: "Incident Response",
    });
    assert(chatPathname === chatPath);
});

type UpdateToolUpdate = Parameters<typeof callAgentWebUpdateTool>[1]["updates"][number];

function printDisplayMessage(displayMessage: ErrorDisplayMessage): string {
    let string = "";

    for (const segment of displayMessage) {
        switch (segment.type) {
            case "Text":
            case "SensitiveText":
                string += segment.text;
                break;
            case "Link":
                string += segment.text;
                break;
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

async function expectInvalidUpdateDisplayMessage({
    path = chatPath,
    updates,
    expected,
}: {
    path?: string;
    updates: ReadonlyArray<UpdateToolUpdate>;
    expected: string;
}) {
    const result = await captureResultPromise(
        async () => await callAgentWebUpdateTool(context, {path, updates}),
    );

    if (result.ok) {
        throw new InternalError("Expected update tool call to throw");
    }

    expect(printDisplayMessage(getDisplayMessage(result.error))).toEqual(expected);
    expect(result.error).toBeInstanceOf(InvalidArgumentError);
}

function createMessage({
    index,
    author = index % 2 === 0 ? aliceAccount : bobAccount,
    content = `Message ${index}`,
    createdTime = new Date(Date.UTC(2026, 4, 14, 15, index * 5)).toISOString(),
    parent,
}: {
    index: number;
    author?: ApiAccount;
    content?: ApiContentResponse | string;
    createdTime?: string;
    parent?: ApiMessageMockParent;
}): ApiMessageResponse {
    return createApiMessageMock({
        index,
        author,
        content,
        createdTime,
        parent,
    });
}

function getReadPageInfo(path: string): {
    from?: "Start" | "End";
    cursor?: number;
} {
    const url = new UrlPath(path);

    if (url.searchParams.has("start")) {
        return {};
    }

    const after = url.searchParams.get("after");
    if (after !== null) {
        return {cursor: parseInt(after, 10)};
    }

    const before = url.searchParams.get("before");
    if (before !== null) {
        return {from: "End", cursor: parseInt(before, 10)};
    }

    return {from: "End"};
}

async function readChat({
    path = chatPath,
    limit = "100kb",
    totalMessageCount,
    createMessage: actuallyCreateMessage,
    readContext = context,
}: {
    path?: string;
    limit?: string;
    totalMessageCount: number;
    createMessage?: (index: number) => ApiMessageResponse;
    readContext?: AgentWebContext;
}): Promise<string> {
    mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

    mockApiGetChatMessages(api, {
        spaceId,
        chatId,
        ...getReadPageInfo(path),
        totalMessageCount,
        limit: 30,
        createMessage:
            actuallyCreateMessage ??
            (index => createMessage({index, author: index % 2 === 0 ? aliceAccount : bobAccount})),
    });

    return await callAgentWebReadTool(readContext, {path, limit});
}

async function readDirectChat({
    totalMessageCount,
    createMessage: actuallyCreateMessage,
}: {
    totalMessageCount: number;
    createMessage?: (index: number) => ApiMessageResponse;
}): Promise<{path: string; response: string}> {
    const directChatId = generateId<ChatId>();
    const path = await createAgentWebPageStoredLinkPathname(storage, {
        type: "Chat",
        id: directChatId,
        title: "Alice and Bob",
    });

    api.mockGet(
        "/chats/{id}",
        {
            data: {
                spaceId,
                chat: {
                    type: "Direct",
                    id: directChatId,
                    members: [{account: aliceAccount}, {account: bobAccount}],
                    reference: {title: "Alice and Bob"},
                },
            },
        },
        {path: {id: directChatId}},
    );

    mockApiGetChatMessages(api, {
        spaceId,
        chatId: directChatId,
        from: "End",
        totalMessageCount,
        limit: 30,
        createMessage:
            actuallyCreateMessage ??
            (index => createMessage({index, author: index % 2 === 0 ? aliceAccount : bobAccount})),
    });

    const response = await callAgentWebReadTool(context, {path, limit: "100kb"});

    return {path, response};
}

test("throws UnimplementedError when converting a direct chat to a room chat", async () => {
    const {path} = await readDirectChat({totalMessageCount: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path,
            updates: [
                {
                    old: "Chat with [Alice](/human/alice) and [Bob](/human/bob).",
                    new: "# Incident Response",
                    replaceAll: false,
                },
            ],
        }),
    ).rejects.toThrow(UnimplementedError);
});

test("rejects changing direct chat members", async () => {
    const {path} = await readDirectChat({totalMessageCount: 1});

    await expectInvalidUpdateDisplayMessage({
        path,
        updates: [
            {
                old: "Chat with [Alice](/human/alice) and [Bob](/human/bob).",
                new: "Chat with [Alice](/human/alice).",
                replaceAll: false,
            },
        ],
        expected:
            "Can\u2019t add or remove members from a chat. Instead try calling the `create` tool to create a new chat instead. If you must preserve the chat message history then try using the `update` tool to convert this chat into a named chat room by replacing the chat member list with a markdown h1 with the new chat room name. In most cases it\u2019s better to use the `create` tool to create a new chat because converting to a named chat room is an irreversible decision.",
    });
});

test("rejects converting a room chat to a direct chat", async () => {
    await readChat({totalMessageCount: 2});

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "# Incident Response",
                new: "Chat with [Alice](/human/alice) and [Bob](/human/bob).",
                replaceAll: false,
            },
        ],
        expected:
            "A named chat room can\u2019t be converted into a direct chat. Try calling the `create` tool to create a new direct chat instead.",
    });
});

test("throws UnimplementedError when renaming a room chat", async () => {
    await readChat({totalMessageCount: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "# Incident Response",
                    new: "# Escalated Incident Response",
                    replaceAll: false,
                },
            ],
        }),
    ).rejects.toThrow(UnimplementedError);
});

test("rejects preamble edits", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "# Incident Response",
                new: "## Incident Response",
                replaceAll: false,
            },
        ],
        expected:
            "Chat markdown must start with \u201CChat with\u201D followed by a list of chat members (e.g. `Chat with [John](/human/john-doe) and [Jane](/human/jane-doe).` or for chats with 2+ members `Chat with A, B, and C.`). Chat markdown for named chat rooms must start with a markdown h1 (e.g. `# My Chat Room`). Try again with a proper start to chat markdown on line 1.",
    });
});
