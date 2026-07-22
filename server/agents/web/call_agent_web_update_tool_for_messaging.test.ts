// NOTE: We mostly use chats in this file to test general
// `updateAgentWebMessagingPage()` behavior through `callAgentWebUpdateTool()`. For
// chat-specific tests see
// `server/agents/web/call_agent_web_update_tool_chat.test.ts`.

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
import type {
    AgentWebMessagingPage,
    AgentWebMessagingPageCustomBlockBase,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {agentWebMessagingPageMessageNouns} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {getReadAgentWebMessagingPageAroundMessageStartCursor} from "~/server/agents/web/pages/messaging/read_agent_web_messaging_page.js";
import {updateAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/update_agent_web_messaging_page.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    ApiAccountResponse,
    ApiContentResponse,
    ApiMessageContentPayloadFileResponse,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {UrlPath} from "~/shared/helpers/http/url_path.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, ChatId, DocumentId, FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const chatId = generateId<ChatId>();
const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();

const aliceAccount = createApiAccountMock({name: "Alice"});
const bobAccount = createApiAccountMock({name: "Bob"});
const botApiAccount = createApiAccountMock({
    id: botAccountId,
    name: "ChatGPT",
    botId,
});

const {span} = testTracer.startSpan("call_agent_web_update_tool_messaging.test.ts");
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

function createTextContent(text: string): ApiContentResponseWithoutKeys {
    return {elements: [{type: "Paragraph", elements: [{type: "Text", text}]}]};
}

function createImageMessageFiles(
    count: number,
): ReadonlyArray<ApiMessageContentPayloadFileResponse> {
    return Array.from({length: count}, (_, index) => {
        const rowIndex = Math.floor(index / 3);
        const rowStartIndex = rowIndex * 3;
        const rowFileCount = Math.min(3, count - rowStartIndex);

        return {
            rowIndex,
            width: 1 / rowFileCount,
            element: {
                type: "File" as const,
                file: {
                    id: generateChronologicalId<FileId>(),
                    contentType: "image/png" as const,
                    contentLength: 100 + index,
                },
            },
        };
    });
}

function createMessage({
    index,
    author = index % 2 === 0 ? aliceAccount : bobAccount,
    content = `Message ${index}`,
    createdTime = new Date(Date.UTC(2026, 4, 14, 15, index * 5)).toISOString(),
    parent,
    files = [],
}: {
    index: number;
    author?: ApiAccountResponse;
    content?: ApiContentResponse | string;
    createdTime?: string;
    parent?: ApiMessageMockParent;
    files?: ReadonlyArray<ApiMessageContentPayloadFileResponse>;
}): ApiMessageResponse {
    return createApiMessageMock({
        index,
        author,
        content,
        createdTime,
        parent,
        files,
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

    const message = url.searchParams.get("message");
    if (message !== null) {
        const messageIndex = Number(message);
        assert(Number.isInteger(messageIndex));

        return {
            cursor: getReadAgentWebMessagingPageAroundMessageStartCursor({
                startMessageIndex: messageIndex,
                endMessageIndex: messageIndex + 1,
            }),
        };
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

function mockCreateMessages({count, startIndex = 0}: {count: number; startIndex?: number}) {
    for (let index = 0; index < count; index++) {
        api.mockPost("/chats/{id}/messages", {
            params: {path: {id: chatId}},
            data: {
                spaceId,
                message: createMessage({
                    index: startIndex + index,
                    author: botApiAccount,
                    content: "Created message response",
                }),
            },
        });
    }
}

function getCreateMessageRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "POST" && request.path === "/chats/{id}/messages");
}

test("creates the first message in an empty chat", async () => {
    await readChat({totalMessageCount: 0});
    mockCreateMessages({count: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message from="[ChatGPT](/bot/chatgpt)">\n\nFirst bot update.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("First bot update."),
        },
    ]);
});

test("creates a message without a from attribute", async () => {
    await readChat({totalMessageCount: 0});
    mockCreateMessages({count: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: "\n\n<message>\n\nFirst implicit-author update.\n\n</message>\n\nEnd of messages.",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("First implicit-author update."),
        },
    ]);
});

test("creates a message with file attachments", async () => {
    const firstFileId = generateChronologicalId<FileId>();
    const firstFilePathname = await createAgentWebPageStoredLinkPathname(storage, {
        type: "File",
        id: firstFileId,
        contentType: "image/png",
        contentLength: 100,
    });

    const secondFileId = generateChronologicalId<FileId>();
    const secondFilePathname = await createAgentWebPageStoredLinkPathname(storage, {
        type: "File",
        id: secondFileId,
        contentType: "image/png",
        contentLength: 200,
    });

    const documentId = generateId<DocumentId>();
    const documentPathname = await createAgentWebPageStoredLinkPathname(storage, {
        type: "Document",
        id: documentId,
        title: "Launch plan",
    });

    await readChat({totalMessageCount: 0});
    mockCreateMessages({count: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: `\n\n<message from="[ChatGPT](/bot/chatgpt)">\n\nFiles for review.\n\n<div style="display: flex">\n<img src="${firstFilePathname}" />\n<img src="${secondFilePathname}" />\n</div>\n\n![Launch plan](${documentPathname})\n\n</message>\n\nEnd of messages.`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("Files for review."),
            files: [
                {element: {type: "File", file: {id: firstFileId}}},
                {element: {type: "File", file: {id: secondFileId}}},
                {element: {type: "Preview", reference: {type: "Document", id: documentId}}},
            ],
        },
    ]);
});

test("creates a message with the next valid id after existing messages", async () => {
    await readChat({
        totalMessageCount: 2,
        createMessage: index =>
            createMessage({
                index,
                author: aliceAccount,
                content: `Alice message ${index}`,
            }),
    });
    mockCreateMessages({count: 1, startIndex: 2});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="2" from="[ChatGPT](/bot/chatgpt)">\n\nBot reply with id.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("Bot reply with id."),
        },
    ]);
});

test("creates multiple messages in one update in order", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });
    mockCreateMessages({count: 2, startIndex: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\nFirst new message.\n\n</message>\n\n<message id="2" from="[ChatGPT](/bot/chatgpt)">\n\nSecond new message.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("First new message."),
        },
        {
            content: createTextContent("Second new message."),
        },
    ]);
});

test("allows a later new message to quote an earlier new message", async () => {
    await readChat({totalMessageCount: 0});
    mockCreateMessages({count: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="0" from="[ChatGPT](/bot/chatgpt)">\n\nParent from this update.\n\n</message>\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\n<blockquote cite="?message=0">\n\n[ChatGPT](/bot/chatgpt): Parent from this update.\n\n</blockquote>\n\nReplying to the message we just created.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/chat/incident-response`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc (This update was a partial success. You must call the `read` tool again for `/chat/incident-response` to find out which parts of the update were successful.)",
    );

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("Parent from this update."),
        },
    ]);
});

test("reports unseen messages after creating one message in an empty chat", async () => {
    await readChat({totalMessageCount: 0});
    mockCreateMessages({count: 1, startIndex: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message from="[ChatGPT](/bot/chatgpt)">\n\nNew message after unseen message.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        // NOCOMMIT: Can we do better at all here? Maybe not call it an "Error"?
        "Error: Couldn\u2019t update `/chat/incident-response`. " +
            "Update was successful, the message you added was created. But between the last message you read and the message you created there are some new messages from others you haven\u2019t seen. These new messages may not be relevant to you, but if you want to see them anyway you can call the `read` tool with `/chat/incident-response?start`. (This update was a partial success. You must call the `read` tool again for `/chat/incident-response` to find out which parts of the update were successful.)",
    );

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("New message after unseen message."),
        },
    ]);
});

test("reports unseen messages after creating multiple messages in an empty chat", async () => {
    await readChat({totalMessageCount: 0});
    mockCreateMessages({count: 2, startIndex: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="0" from="[ChatGPT](/bot/chatgpt)">\n\nFirst new message after unseen message.\n\n</message>\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\nSecond new message after unseen message.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/chat/incident-response`. " +
            "Update was successful, the messages you added were created. But between the last message you read and the messages you created there are some new messages from others you haven\u2019t seen. These new messages may not be relevant to you, but if you want to see them anyway you can call the `read` tool with `/chat/incident-response?start`. (This update was a partial success. You must call the `read` tool again for `/chat/incident-response` to find out which parts of the update were successful.)",
    );

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("First new message after unseen message."),
        },
        {
            content: createTextContent("Second new message after unseen message."),
        },
    ]);
});

test("reports unseen messages after creating one message with existing messages", async () => {
    await readChat({
        totalMessageCount: 2,
        createMessage: index =>
            createMessage({
                index,
                author: aliceAccount,
                content: `Alice message ${index}`,
            }),
    });
    mockCreateMessages({count: 1, startIndex: 3});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="2" from="[ChatGPT](/bot/chatgpt)">\n\nNew message after unseen existing message.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/chat/incident-response`. " +
            'Update was successful, the message you added was created. But between the last message you read (`<message id="1">`) and the message you created there are some new messages from others you haven\u2019t seen. These new messages may not be relevant to you, but if you want to see them anyway you can call the `read` tool with `/chat/incident-response?after=2`. (This update was a partial success. You must call the `read` tool again for `/chat/incident-response` to find out which parts of the update were successful.)',
    );

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("New message after unseen existing message."),
        },
    ]);
});

test("reports unseen messages after creating multiple messages with existing messages", async () => {
    await readChat({
        totalMessageCount: 2,
        createMessage: index =>
            createMessage({
                index,
                author: aliceAccount,
                content: `Alice message ${index}`,
            }),
    });
    mockCreateMessages({count: 2, startIndex: 3});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="2" from="[ChatGPT](/bot/chatgpt)">\n\nFirst new message after unseen existing messages.\n\n</message>\n\n<message id="3" from="[ChatGPT](/bot/chatgpt)">\n\nSecond new message after unseen existing messages.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/chat/incident-response`. " +
            'Update was successful, the messages you added were created. But between the last message you read (`<message id="1">`) and the messages you created there are some new messages from others you haven\u2019t seen. These new messages may not be relevant to you, but if you want to see them anyway you can call the `read` tool with `/chat/incident-response?after=2`. (This update was a partial success. You must call the `read` tool again for `/chat/incident-response` to find out which parts of the update were successful.)',
    );

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("First new message after unseen existing messages."),
        },
        {
            content: createTextContent("Second new message after unseen existing messages."),
        },
    ]);
});

test("creates a message on the final page when earlier messages are paginated", async () => {
    const response = await readChat({
        limit: "3kb",
        totalMessageCount: 31,
        createMessage: index => createMessage({index, content: `Existing message ${index}`}),
    });
    expect(response).toContain("[Previous page »](/chat/incident-response?before=");

    mockCreateMessages({count: 1, startIndex: 31});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="31" from="[ChatGPT](/bot/chatgpt)">\n\nNew message on final page.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("New message on final page."),
        },
    ]);
});

test("counts newly-created messages without ids when validating the next id", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });
    mockCreateMessages({count: 1, startIndex: 1});

    await callAgentWebUpdateTool(context, {
        path: chatPath,
        updates: [
            {
                old: "\n\nEnd of messages.",
                new: '\n\n<message from="[ChatGPT](/bot/chatgpt)">\n\nNew message without id.\n\n</message>\n\nEnd of messages.',
                replaceAll: false,
            },
        ],
    });

    mockCreateMessages({count: 1, startIndex: 2});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="2" from="[ChatGPT](/bot/chatgpt)">\n\nNew message after null id.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("New message without id."),
        },
        {
            content: createTextContent("New message after null id."),
        },
    ]);
});

test("counts newly-created messages without ids when validating the next id (error case 1)", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });
    mockCreateMessages({count: 1, startIndex: 1});

    await callAgentWebUpdateTool(context, {
        path: chatPath,
        updates: [
            {
                old: "\n\nEnd of messages.",
                new: '\n\n<message from="[ChatGPT](/bot/chatgpt)">\n\nNew message without id.\n\n</message>\n\nEnd of messages.',
                replaceAll: false,
            },
        ],
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="3" from="[ChatGPT](/bot/chatgpt)">\n\nNew message after null id.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. Invalid `id` attribute for new `<message>`. The `<message>` `id` attribute is an integer sequence so the next valid `id` is 2. Try again with `id="2"`.',
    );

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("New message without id."),
        },
    ]);
});

test("counts newly-created messages without ids when validating the next id (error case 2)", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });
    mockCreateMessages({count: 1, startIndex: 1});

    await callAgentWebUpdateTool(context, {
        path: chatPath,
        updates: [
            {
                old: "\n\nEnd of messages.",
                new: '\n\n<message from="[ChatGPT](/bot/chatgpt)">\n\nNew message without id.\n\n</message>\n\nEnd of messages.',
                replaceAll: false,
            },
        ],
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\nNew message after null id.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. Invalid `id` attribute for new `<message>`. The `<message>` `id` attribute is an integer sequence so the next valid `id` is 2. Try again with `id="2"`.',
    );

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("New message without id."),
        },
    ]);
});

test("rejects pagination link edits", async () => {
    const response = await readChat({
        limit: "3kb",
        totalMessageCount: 31,
        createMessage: index => createMessage({index, content: `Existing message ${index}`}),
    });
    expect(response).toContain("[Previous page »](/chat/incident-response?before=");

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "?before=3",
                    new: "?before=7",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/chat/incident-response`. " +
            "You can only update your `<message>`s. You can\u2019t update the previous/next page links in the messages markdown. Try again with a more specific update that only changes the content of messages from you or adds new messages.",
    );
});

test("rejects time marker edits", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "11:00am",
                    new: "12:00pm",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/chat/incident-response`. " +
            "You can only update your `<message>`s. You can\u2019t update `<time>`s which indicate when previous `<message>`s were sent. Try again with a more specific update that only changes the content of messages from you or adds new messages.",
    );
});

test("rejects edits to messages from another account", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: aliceAccount, content: "Alice original"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [{old: "Alice original", new: "Alice edited by ChatGPT", replaceAll: false}],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. You can only update your `<message>`s. You can\u2019t update a `<message>` created by Alice. `<message id="0" from="Alice">` was changed by this update. Try again with a more specific update that only changes the content of messages from you or adds new messages.',
    );
});

test("rejects changing an existing bot message into another account\u2019s message", async () => {
    await readChat({
        totalMessageCount: 2,
        createMessage: index =>
            index === 0
                ? createMessage({index, author: aliceAccount, content: "Alice original"})
                : createMessage({index, author: botApiAccount, content: "Bot original"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: '<message id="1" from="[ChatGPT](/bot/chatgpt)" time="5 minutes later">\n\nBot original\n\n</message>',
                    new: '<message id="1" from="[Alice](/human/alice)" time="5 minutes later">\n\nBot original\n\n</message>',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. You can only update the content of your `<message>`s. Any metadata (the `id`/`from`/`time` attributes or `<blockquote cite>`) must be left unchanged. The metadata of `<message id="1">` was changed by this update. Try again with a more specific update that only changes the content of messages from you.',
    );
});

test("rejects edits to existing message metadata", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: botApiAccount, content: "Bot original"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: 'id="0" from="[ChatGPT',
                    new: 'id="7" from="[ChatGPT',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. You can only update the content of your `<message>`s. Any metadata (the `id`/`from`/`time` attributes or `<blockquote cite>`) must be left unchanged. The metadata of `<message id="0">` was changed by this update. Try again with a more specific update that only changes the content of messages from you.',
    );
});

test("rejects edits to an existing bot message blockquote parent", async () => {
    await readChat({
        totalMessageCount: 2,
        createMessage: index =>
            index === 0
                ? createMessage({index, author: aliceAccount, content: "Parent message"})
                : createMessage({
                      index,
                      author: botApiAccount,
                      content: "Bot reply",
                      parent: {
                          author: aliceAccount,
                          index: 0,
                          contentSnippet: "Parent message",
                      },
                  }),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: '<blockquote cite="?message=0">',
                    new: '<blockquote cite="?message=1">',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. You can only update the content of your `<message>`s. Any metadata (the `id`/`from`/`time` attributes or `<blockquote cite>`) must be left unchanged. The metadata of `<message id="1">` was changed by this update. Try again with a more specific update that only changes the content of messages from you.',
    );
});

test("rejects removing message blocks", async () => {
    await readChat({
        totalMessageCount: 2,
        createMessage: index =>
            createMessage({
                index,
                author: index === 0 ? aliceAccount : bobAccount,
                content: `Message ${index}`,
            }),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: '\n\n<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nMessage 1\n\n</message>',
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/chat/incident-response`. " +
            "You can\u2019t remove `<message>`s. If you want to delete one of your `<message>`s, then delete all the content of your `<message>`. You can only delete your own `<message>`s. Try again with a more specific update that only changes the content of messages from you.",
    );
});

test("rejects creating messages before the end of the chat", async () => {
    const path = `${chatPath}?start`;
    await readChat({path, limit: "1kb", totalMessageCount: 31});

    await expect(
        callAgentWebUpdateTool(context, {
            path: path,
            updates: [
                {
                    old: "Message 9\n\n</message>",
                    new: 'Message 9\n\n</message>\n\n<message from="[ChatGPT](/bot/chatgpt)">\n\nToo early.\n\n</message>',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        `Error: Couldn\u2019t update \`${path}\`. ` +
            "You can only add a `<message>` after all other messages (messages are in chronological order). Look for \u201CEnd of messages\u201D to know when you\u2019re at the end of a message list. Call the `read` tool with `/chat/incident-response?end` to jump to the end of a message list.",
    );
});

test.each([
    {path: `${chatPath}?start`, pageDescription: "start page"},
    {path: `${chatPath}?message=4`, pageDescription: "message page"},
])(
    "rejects creating messages on a truncated $pageDescription that originally reached the end",
    async ({path}) => {
        const response = await readChat({path, limit: "1kb", totalMessageCount: 20});
        expect(response).toContain("[Next page »](/chat/incident-response?after=");
        expect(response).not.toContain("End of messages.");

        const lastMessage = getLastMessageMarkdown(response);

        function getLastMessageMarkdown(response: string): string {
            let lastMessage: string | null = null;

            for (const match of response.matchAll(/<message\b[\s\S]*?<\/message>/g)) {
                lastMessage = match[0];
            }

            assert(lastMessage !== null);
            return lastMessage;
        }

        await expect(
            callAgentWebUpdateTool(context, {
                path: path,
                updates: [
                    {
                        old: lastMessage,
                        new: `${lastMessage}\n\n<message from="[ChatGPT](/bot/chatgpt)">\n\nToo early after truncation.\n\n</message>`,
                        replaceAll: false,
                    },
                ],
            }),
        ).resolves.toEqual(
            `Error: Couldn\u2019t update \`${path}\`. ` +
                "You can only add a `<message>` after all other messages (messages are in chronological order). Look for \u201CEnd of messages\u201D to know when you\u2019re at the end of a message list. Call the `read` tool with `/chat/incident-response?end` to jump to the end of a message list.",
        );

        expect(getCreateMessageRequests()).toEqual([]);
    },
);

test("rejects creating messages from another account", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: aliceAccount, content: "Alice original"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message from="[Alice](/human/alice)">\n\nNot from the bot.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. You can only add a `<message>` from yourself. Try again with a `from` attribute that references yourself (`from="[ChatGPT](/bot/chatgpt)"`).',
    );
});

test("rejects creating messages with an incorrect id", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="3" from="[ChatGPT](/bot/chatgpt)">\n\nWrong id.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. Invalid `id` attribute for new `<message>`. The `<message>` `id` attribute is an integer sequence so the next valid `id` is 1. Try again with `id="1"`.',
    );
});

test("rejects creating messages with a time attribute", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message from="[ChatGPT](/bot/chatgpt)" time="3 minutes later">\n\nServer should choose the time.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/chat/incident-response`. " +
            "You can\u2019t add a `<message>` with a `time` attribute. The creation time of the message will be decided by the server. Try again without the `time` attribute.",
    );
});

test("rejects creating time markers", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: "\n\n<time>May 14th at 11:05am EDT</time>\n\nEnd of messages.",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/chat/incident-response`. " +
            "Unexpected `<time>`, you can only add `<message>`s. The creation time of messages will be decided by the server. Try again and remove the new `<time>`.",
    );
});

test("rejects creating non-message custom blocks", async () => {
    type StatusCustomBlock = AgentWebMessagingPageCustomBlockBase & {
        readonly tagName: "status";
    };

    const oldPage: AgentWebMessagingPage<null, StatusCustomBlock> = {
        preamble: null,
        pagination: null,
        isEndOfMessages: true,
        blocks: [],
    };

    const newPage: AgentWebMessagingPage<null, StatusCustomBlock> = {
        ...oldPage,
        blocks: [{type: "Custom", tagName: "status", timeAttribute: null}],
    };

    await expect(
        updateAgentWebMessagingPage(context, {
            messageNouns: agentWebMessagingPageMessageNouns,
            pathname: chatPath,
            room: {type: "Chat", id: chatId},
            oldPageMetadata: {isStartOfMessages: true, isEndOfMessages: true, messages: []},
            oldPage,
            newPage,
            prepareCustomBlockUpdate: () => ({update: async () => {}}),
        }),
    ).rejects.toThrow("Can only create messages");
});

test("allows removing the end marker while creating messages", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });
    mockCreateMessages({count: 1, startIndex: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\nMissing end marker.\n\n</message>',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("Missing end marker."),
        },
    ]);
});

test("allows removing the end marker while creating messages and then allows creating another message", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });
    mockCreateMessages({count: 2, startIndex: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\nTest message 1\n\n</message>',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "Test message 1\n\n</message>",
                    new: 'Test message 1\n\n</message>\n\n<message id="2" from="[ChatGPT](/bot/chatgpt)">\n\nTest message 2\n\n</message>',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {content: createTextContent("Test message 1")},
        {content: createTextContent("Test message 2")},
    ]);
});

test("allows removing the end marker while creating messages and then allows creating another message with an end marker", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });
    mockCreateMessages({count: 2, startIndex: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\nTest message 1\n\n</message>',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "Test message 1\n\n</message>",
                    new: 'Test message 1\n\n</message>\n\n<message id="2" from="[ChatGPT](/bot/chatgpt)">\n\nTest message 2\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {content: createTextContent("Test message 1")},
        {content: createTextContent("Test message 2")},
    ]);
});

test("allows removing the end marker without creating messages", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: "",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");
});

test("rejects adding the end marker to a non-final page", async () => {
    const path = `${chatPath}?start`;
    await readChat({path, limit: "1kb", totalMessageCount: 31});

    await expect(
        callAgentWebUpdateTool(context, {
            path: path,
            updates: [
                {
                    old: '<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nMessage 9\n\n</message>',
                    new: '<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nMessage 9\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        `Error: Couldn\u2019t update \`${path}\`. ` +
            "Can\u2019t add the \u201CEnd of messages\u201D marker in an update. Only a `read` tool call can tell you whether you\u2019re at the end of a message list or not. Try again without adding the \u201CEnd of messages\u201D marker.",
    );
});

test("throws UnimplementedError when updating existing bot message content", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: botApiAccount, content: "Bot original"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [{old: "Bot original", new: "Bot edited", replaceAll: false}],
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/chat/incident-response\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Message update API endpoint hasn\u2019t been implemented yet`);
});

test("throws UnimplementedError when updating existing bot message content with unchanged files", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({
                index,
                author: botApiAccount,
                content: "Bot original",
                files: createImageMessageFiles(2),
            }),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [{old: "Bot original", new: "Bot edited", replaceAll: false}],
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/chat/incident-response\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Message update API endpoint hasn\u2019t been implemented yet`);
});

test("rejects removing files from an existing bot message", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({
                index,
                author: botApiAccount,
                content: "Bot original",
                files: createImageMessageFiles(1),
            }),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [{old: "\n\n![](/file/image.png)", new: "", replaceAll: false}],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. You can only update the text of your `<message>`s. You can\u2019t add, remove, or reorder files attached to an existing `<message>`. Try again but leave the file attachments at the end of `<message id="0">` exactly as they appeared.',
    );
});

test("rejects adding files to an existing bot message", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({
                index,
                author: botApiAccount,
                content: "Bot original",
                files: createImageMessageFiles(1),
            }),
    });

    const addedFilePathname = await createAgentWebPageStoredLinkPathname(storage, {
        type: "File",
        id: generateChronologicalId<FileId>(),
        contentType: "image/png",
        contentLength: 200,
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "![](/file/image.png)",
                    new: `![](/file/image.png)\n\n![](${addedFilePathname})`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. You can only update the text of your `<message>`s. You can\u2019t add, remove, or reorder files attached to an existing `<message>`. Try again but leave the file attachments at the end of `<message id="0">` exactly as they appeared.',
    );
});

test("rejects reordering files in an existing bot message", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({
                index,
                author: botApiAccount,
                content: "Bot original",
                files: createImageMessageFiles(2),
            }),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: '<img src="/file/image.png" />\n<img src="/file/image-2.png" />',
                    new: '<img src="/file/image-2.png" />\n<img src="/file/image.png" />',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. You can only update the text of your `<message>`s. You can\u2019t add, remove, or reorder files attached to an existing `<message>`. Try again but leave the file attachments at the end of `<message id="0">` exactly as they appeared.',
    );
});

test("throws UnimplementedError when deleting existing bot message content", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: botApiAccount, content: "Bot original"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [{old: "Bot original", new: "", replaceAll: false}],
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/chat/incident-response\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Message delete API endpoint hasn\u2019t been implemented yet`);
});

test("throws UnimplementedError when creating a reply with a blockquote parent", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: aliceAccount, content: "Parent message"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\n<blockquote cite="?message=0">\n\n[Alice](/human/alice): Parent message\n\n</blockquote>\n\nReplying to the parent.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/chat/incident-response\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Creating message with parent as agent isn\u2019t implemented yet`);
});

test("throws UnimplementedError when creating a reply to a bullet list item", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({
                index,
                author: aliceAccount,
                content: {
                    elements: [
                        {
                            type: "UnorderedList",
                            items: [
                                {
                                    elements: [
                                        {
                                            type: "Paragraph",
                                            key: "bullet-parent" as ApiContentKey,
                                            elements: [{type: "Text", text: "quoted"}],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            }),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\n<blockquote cite="?message=0">\n\n[Alice](/human/alice):\n\n- quoted\n\n</blockquote>\n\nReplying to the parent list item.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/chat/incident-response\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Creating message with parent as agent isn\u2019t implemented yet`);
    expect(getCreateMessageRequests()).toEqual([]);
});

test("rejects creating a reply when the quoted parent content is not found", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: aliceAccount, content: "Parent message"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\n<blockquote cite="?message=0">\n\n[Alice](/human/alice): Missing parent message\n\n</blockquote>\n\nReplying to the parent.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/chat/incident-response`. " +
            "Couldn\u2019t find the quoted content in `<blockquote>` in the current message page. To create a message that replies to another message you must exactly recreate the content you\u2019re replying to in `<blockquote>` so we can find the corresponding range in the messages on this page. If you\u2019re trying to quote a message that\u2019s not on this page then call the `read` tool with a larger `limit` so that the message you\u2019re replying to is on the same page you\u2019re updating. Formatting is flexible when matching content so `**needle**` will match `**foo needle bar**` and `- needle` will match `- foo needle bar` because `**needle**` and `- needle` correctly match the word \u201cneedle\u201d and have the right formatting. Simply `needle` without formatting will also match `**foo needle bar**` and `- foo needle bar` however `_needle_` will match neither because it has incorrect formatting. Your content in `<blockquote>` must be valid markdown so `**foo needle` won\u2019t match `**foo needle bar**` because the formatting (`**`) is unterminated, either `**foo needle**` or `foo needle` (without formatting) will match. Try again but make sure to exactly copy the content you want to reply to in the current message page into a `<blockquote>`.",
    );

    expect(getCreateMessageRequests()).toEqual([]);
});

test("rejects creating a reply when the cited parent message is not on the page", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: aliceAccount, content: "Parent message"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\n<blockquote cite="?message=4">\n\n[Alice](/human/alice): Parent message\n\n</blockquote>\n\nReplying to a parent that is not on this page.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. Couldn\u2019t find `<message id="4">` referenced by `<blockquote cite="?message=4">` on the current page. To create a message that replies to another message, the cited message must be visible on the current page. If you\u2019re trying to quote a message that\u2019s not on this page then call the `read` tool with a larger `limit` so that the message you\u2019re replying to is on the same page you\u2019re updating. Try again without the `<blockquote>`, with a different `cite` attribute that references a message on the current page, or with a larger limit when calling `read` so the `<message>` you\u2019re replying to is on the same page you\u2019re updating.',
    );

    expect(getCreateMessageRequests()).toEqual([]);
});

test("rejects creating a reply when the blockquote author prefix is wrong", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: aliceAccount, content: "Parent message"}),
    });
    await createAgentWebPageStoredLinkPathname(storage, intoApiAccountReference(bobAccount));

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\n<blockquote cite="?message=0">\n\n[Bob](/human/bob): Parent message\n\n</blockquote>\n\nReplying with the wrong author prefix.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. The `<blockquote>` content starts with `[Bob](...): `, but `<message id="0">` is from \u201CAlice\u201D. Try again with `[Alice](...): ` before any other `<blockquote>` content.',
    );

    expect(getCreateMessageRequests()).toEqual([]);
});

test("rejects creating a reply when the quoted parent content matches twice in one message", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: aliceAccount, content: "needle needle"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\n<blockquote cite="?message=0">\n\n[Alice](/human/alice): needle\n\n</blockquote>\n\nReplying to the parent.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. 2 matches were found for the quoted content in `<blockquote>` in `<message id="0">`. Try again but provide more surrounding context to make your match unique or add a 1-indexed `match` attribute to `<blockquote>` to choose which match to use (e.g. `<blockquote match="2">` uses the second match).',
    );

    expect(getCreateMessageRequests()).toEqual([]);
});

test("rejects creating a reply when the quote match is out of bounds for one match", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: aliceAccount, content: "Parent message"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\n<blockquote cite="?message=0" match="2">\n\n[Alice](/human/alice): Parent message\n\n</blockquote>\n\nReplying to the parent.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. The `<blockquote>` `match` attribute must be 1 or it can be omitted since there\u2019s only one match, instead it was `match="2"`. Try again but omit the `match` attribute.',
    );

    expect(getCreateMessageRequests()).toEqual([]);
});

test("rejects creating a reply when the quote match is out of bounds for multiple matches", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: aliceAccount, content: "needle needle"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\n<blockquote cite="?message=0" match="3">\n\n[Alice](/human/alice): needle\n\n</blockquote>\n\nReplying to the parent.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. The `<blockquote>` `match` attribute must be between 1 and 2, instead it was `match="3"`. Try again with a valid 1-indexed `match` attribute.',
    );

    expect(getCreateMessageRequests()).toEqual([]);
});

test("uses quote match when creating a reply to repeated parent content", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({
                index,
                author: aliceAccount,
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            key: "repeated-parent" as ApiContentKey,
                            elements: [{type: "Text", text: "needle needle"}],
                        },
                    ],
                },
            }),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\n<blockquote cite="?message=0" match="2">\n\n[Alice](/human/alice): needle\n\n</blockquote>\n\nReplying to the second match.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/chat/incident-response\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Creating message with parent as agent isn\u2019t implemented yet`);
    expect(getCreateMessageRequests()).toEqual([]);
});

test("only searches the cited message when creating a reply", async () => {
    await readChat({
        totalMessageCount: 3,
        createMessage: index =>
            createMessage({
                index,
                author: index === 1 ? bobAccount : aliceAccount,
                content: index === 1 ? "Different author duplicate" : "Duplicate parent",
            }),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="3" from="[ChatGPT](/bot/chatgpt)">\n\n<blockquote cite="?message=0">\n\n[Alice](/human/alice): Duplicate parent\n\n</blockquote>\n\nReplying to the parent.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/chat/incident-response\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Creating message with parent as agent isn\u2019t implemented yet`);

    expect(getCreateMessageRequests()).toEqual([]);
});

test("rejects creating a reply when cite overlaps but does not match a merged message block", async () => {
    const page = await readChat({
        totalMessageCount: 2,
        createMessage: index =>
            createMessage({
                index,
                author: aliceAccount,
                createdTime: new Date(Date.UTC(2026, 4, 14, 15, index * 3)).toISOString(),
                content: index === 0 ? "First merged parent." : "Second merged parent.",
            }),
    });
    assert(page.includes('<message id="0-1" from="[Alice](/human/alice)">'));

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="2" from="[ChatGPT](/bot/chatgpt)">\n\n<blockquote cite="?message=1">\n\n[Alice](/human/alice): Second merged parent.\n\n</blockquote>\n\nReplying to one message inside a merged block.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. The `<blockquote>` `cite` attribute must exactly match a `<message>` `id` on the current page. `cite="?message=1"` overlaps with `<message id="0-1">`, but doesn\u2019t exactly match it. Try again with `cite="?message=0-1"`.',
    );

    expect(getCreateMessageRequests()).toEqual([]);
});

test("throws UnimplementedError when replying to content spanning a merged message block", async () => {
    const firstMergedParentParagraph = "First merged parent paragraph.";
    const secondMergedParentParagraph = "Second merged parent paragraph.";

    const page = await readChat({
        totalMessageCount: 2,
        createMessage: index =>
            createMessage({
                index,
                author: aliceAccount,
                createdTime: new Date(Date.UTC(2026, 4, 14, 15, index * 3)).toISOString(),
                content: {
                    elements: [
                        {
                            type: "Paragraph",
                            key: `merged-parent-${index}` as ApiContentKey,
                            elements: [
                                {
                                    type: "Text",
                                    text:
                                        index === 0
                                            ? firstMergedParentParagraph
                                            : secondMergedParentParagraph,
                                },
                            ],
                        },
                    ],
                },
            }),
    });
    assert(page.includes('<message id="0-1" from="[Alice](/human/alice)">'));

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: `\n\n<message id="2" from="[ChatGPT](/bot/chatgpt)">\n\n<blockquote cite="?message=0-1">\n\n[Alice](/human/alice): ${firstMergedParentParagraph}\n\n${secondMergedParentParagraph}\n\n</blockquote>\n\nReplying to both merged messages.\n\n</message>\n\nEnd of messages.`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/chat/incident-response\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Creating message with parent as agent isn\u2019t implemented yet`);
    expect(getCreateMessageRequests()).toEqual([]);
});

test("throws UnimplementedError when creating a message with a timezone attribute", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)" timezone="EDT">\n\nTimezone is explicit.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        "Error: Couldn\u2019t update `/chat/incident-response`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc\n\n> Internal error: Parsing of time zone attribute into \\`TimeZone\\` type hasn\u2019t been implemented",
    );
});

test("throws UnimplementedError without creating when updating and creating together", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: botApiAccount, content: "Bot original"}),
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {old: "Bot original", new: "Bot edited", replaceAll: false},
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\nNew bot message.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/chat/incident-response\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Message update API endpoint hasn\u2019t been implemented yet`);

    expect(getCreateMessageRequests()).toEqual([]);
});

test("throws UnimplementedError when updating a cached new message without an id", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });
    mockCreateMessages({count: 1, startIndex: 1});

    await callAgentWebUpdateTool(context, {
        path: chatPath,
        updates: [
            {
                old: "\n\nEnd of messages.",
                new: '\n\n<message from="[ChatGPT](/bot/chatgpt)">\n\nNew message without id.\n\n</message>\n\nEnd of messages.',
                replaceAll: false,
            },
        ],
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "New message without id.",
                    new: "Edited message without id.",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/chat/incident-response\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Message update API endpoint hasn\u2019t been implemented yet`);
});

test("throws UnimplementedError when updating a cached new message without a from attribute", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });
    mockCreateMessages({count: 1, startIndex: 1});

    await callAgentWebUpdateTool(context, {
        path: chatPath,
        updates: [
            {
                old: "\n\nEnd of messages.",
                new: '\n\n<message id="1">\n\nNew message without author.\n\n</message>\n\nEnd of messages.',
                replaceAll: false,
            },
        ],
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: "New message without author.",
                    new: "Edited message without author.",
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(`\
Error: Couldn\u2019t update \`/chat/incident-response\`. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Message update API endpoint hasn\u2019t been implemented yet`);
});

test("allows adding the current account from attribute to a cached message without a from attribute", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });
    mockCreateMessages({count: 1, startIndex: 1});

    await callAgentWebUpdateTool(context, {
        path: chatPath,
        updates: [
            {
                old: "\n\nEnd of messages.",
                new: '\n\n<message id="1">\n\nNew message without author.\n\n</message>\n\nEnd of messages.',
                replaceAll: false,
            },
        ],
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: '<message id="1">',
                    new: '<message id="1" from="[ChatGPT](/bot/chatgpt)">',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.");

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("New message without author."),
        },
    ]);
});

test("rejects adding another account from attribute to a cached message without a from attribute", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });
    mockCreateMessages({count: 1, startIndex: 1});

    await callAgentWebUpdateTool(context, {
        path: chatPath,
        updates: [
            {
                old: "\n\nEnd of messages.",
                new: '\n\n<message id="1">\n\nNew message without author.\n\n</message>\n\nEnd of messages.',
                replaceAll: false,
            },
        ],
    });

    await expect(
        callAgentWebUpdateTool(context, {
            path: chatPath,
            updates: [
                {
                    old: '<message id="1">',
                    new: '<message id="1" from="[Alice](/human/alice)">',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual(
        'Error: Couldn\u2019t update `/chat/incident-response`. You can only update the content of your `<message>`s. Any metadata (the `id`/`from`/`time` attributes or `<blockquote cite>`) must be left unchanged. The metadata of `<message id="1">` was changed by this update. Try again with a more specific update that only changes the content of messages from you.',
    );
});
