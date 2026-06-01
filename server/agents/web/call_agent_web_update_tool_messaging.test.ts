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
import {createAgentWebPageLinkPathname} from "~/server/agents/web/internal/create_agent_web_page_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {intoApiAccountTarget} from "~/shared/api/specification/into_api_account_target.js";
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
        botId,
        pathname: "/bot/chatgpt",
    },
};

beforeEach(async () => {
    const actualBotAccountPathname = await createAgentWebPageLinkPathname(
        storage,
        context.botAccount,
    );
    assert(actualBotAccountPathname === context.botAccount.pathname);

    const chatPathname = await createAgentWebPageLinkPathname(storage, {
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

    expect(result.error).toBeInstanceOf(InvalidArgumentError);
    expect(printDisplayMessage(getDisplayMessage(result.error))).toEqual(expected);
}

function createTextContent(text: string): ApiContentResponse {
    return {
        elements: [{type: "Paragraph", elements: [{type: "Text", text}]}],
    };
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
    mockApiGetChat(api, {spaceId, chatId});

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

function mockCreateMessages(count: number) {
    for (let index = 0; index < count; index++) {
        api.mockPost(
            "/chats/{id}/messages",
            {
                data: {
                    spaceId,
                    message: createMessage({
                        index,
                        author: botApiAccount,
                        content: "Created message response",
                    }),
                },
            },
            {path: {id: chatId}},
        );
    }
}

function getCreateMessageRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "POST" && request.path === "/chats/{id}/messages");
}

test("creates the first message in an empty chat", async () => {
    await readChat({totalMessageCount: 0});
    mockCreateMessages(1);

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
    ).resolves.toEqual("Update was successful.\n");

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("First bot update."),
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
    mockCreateMessages(1);

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
    ).resolves.toEqual("Update was successful.\n");

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
    mockCreateMessages(2);

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
    ).resolves.toEqual("Update was successful.\n");

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("First new message."),
        },
        {
            content: createTextContent("Second new message."),
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

    mockCreateMessages(1);

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
    ).resolves.toEqual("Update was successful.\n");

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
    mockCreateMessages(1);

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

    mockCreateMessages(1);

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
    ).resolves.toEqual("Update was successful.\n");

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
    mockCreateMessages(1);

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

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "\n\nEnd of messages.",
                new: '\n\n<message id="3" from="[ChatGPT](/bot/chatgpt)">\n\nNew message after null id.\n\n</message>\n\nEnd of messages.',
                replaceAll: false,
            },
        ],
        expected:
            'Invalid `id` attribute for new `<message>`. The `<message>` `id` attribute is an integer sequence so the next valid `id` is `2`. Try again with `id="2"`.',
    });

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
    mockCreateMessages(1);

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

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "\n\nEnd of messages.",
                new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\nNew message after null id.\n\n</message>\n\nEnd of messages.',
                replaceAll: false,
            },
        ],
        expected:
            'Invalid `id` attribute for new `<message>`. The `<message>` `id` attribute is an integer sequence so the next valid `id` is `2`. Try again with `id="2"`.',
    });

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("New message without id."),
        },
    ]);
});

test("rejects preamble edits", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "messages in",
                new: "edited messages in",
                replaceAll: false,
            },
        ],
        expected:
            "You can only update your `<message>`s. You can\u2019t update the metadata on line 1 of the messages markdown. Try again with a more specific update that only changes the content of messages from you or adds new messages.",
    });
});

test("rejects time marker edits", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "11:00am",
                new: "12:00pm",
                replaceAll: false,
            },
        ],
        expected:
            "You can only update your `<message>`s. You can\u2019t update `<time>`s which indicate when previous `<message>`s were sent. Try again with a more specific update that only changes the content of messages from you or adds new messages.",
    });
});

test("rejects edits to messages from another account", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: aliceAccount, content: "Alice original"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [{old: "Alice original", new: "Alice edited by ChatGPT", replaceAll: false}],
        expected:
            'You can only update your `<message>`s. You can\u2019t update a `<message>` created by Alice. `<message id="0" from="Alice">` was changed by this update. Try again with a more specific update that only changes the content of messages from you or adds new messages.',
    });
});

test("rejects changing an existing bot message into another account\u2019s message", async () => {
    await readChat({
        totalMessageCount: 2,
        createMessage: index =>
            index === 0
                ? createMessage({index, author: aliceAccount, content: "Alice original"})
                : createMessage({index, author: botApiAccount, content: "Bot original"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: '<message id="1" from="[ChatGPT](/bot/chatgpt)" time="5 minutes later">\n\nBot original\n\n</message>',
                new: '<message id="1" from="[Alice](/human/alice)" time="5 minutes later">\n\nBot original\n\n</message>',
                replaceAll: false,
            },
        ],
        expected:
            'You can only update the content of your `<message>`s. Any metadata (the `id`/`from`/`time` attributes or `<blockquote cite>`) must be left unchanged. The metadata of `<message id="1">` was changed by this update. Try again with a more specific update that only changes the content of messages from you.',
    });
});

test("rejects edits to existing message metadata", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: botApiAccount, content: "Bot original"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: 'id="0" from="[ChatGPT',
                new: 'id="7" from="[ChatGPT',
                replaceAll: false,
            },
        ],
        expected:
            'You can only update the content of your `<message>`s. Any metadata (the `id`/`from`/`time` attributes or `<blockquote cite>`) must be left unchanged. The metadata of `<message id="0">` was changed by this update. Try again with a more specific update that only changes the content of messages from you.',
    });
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

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: '<blockquote cite="?message=0">',
                new: '<blockquote cite="?message=1">',
                replaceAll: false,
            },
        ],
        expected:
            'You can only update the content of your `<message>`s. Any metadata (the `id`/`from`/`time` attributes or `<blockquote cite>`) must be left unchanged. The metadata of `<message id="1">` was changed by this update. Try again with a more specific update that only changes the content of messages from you.',
    });
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

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: '\n\n<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nMessage 1\n\n</message>',
                new: "",
                replaceAll: false,
            },
        ],
        expected:
            "You can\u2019t remove `<message>`s. If you want to delete one of your `<message>`s, then delete all the content of your `<message>`. You can only delete your own `<message>`s. Try again with a more specific update that only changes the content of messages from you.",
    });
});

test("rejects creating messages before the end of the chat", async () => {
    const path = `${chatPath}?start`;
    await readChat({path, limit: "1kb", totalMessageCount: 31});

    await expectInvalidUpdateDisplayMessage({
        path,
        updates: [
            {
                old: "Message 8\n\n</message>",
                new: 'Message 8\n\n</message>\n\n<message from="[ChatGPT](/bot/chatgpt)">\n\nToo early.\n\n</message>',
                replaceAll: false,
            },
        ],
        expected:
            "You can only add a `<message>` after all other messages (messages are in chronological order). Look for \u201CEnd of messages\u201D to know when you\u2019re at the end of a message list. Call the `read` tool with `/chat/incident-response?end` to jump to the end of a message list.",
    });
});

test("rejects creating messages from another account", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: aliceAccount, content: "Alice original"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "\n\nEnd of messages.",
                new: '\n\n<message from="[Alice](/human/alice)">\n\nNot from the bot.\n\n</message>\n\nEnd of messages.',
                replaceAll: false,
            },
        ],
        expected:
            'You can only add a `<message>` from yourself. Try again with a `from` attribute that references yourself (`from="[ChatGPT](/bot/chatgpt)"`).',
    });
});

test("rejects creating messages with an incorrect id", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "\n\nEnd of messages.",
                new: '\n\n<message id="3" from="[ChatGPT](/bot/chatgpt)">\n\nWrong id.\n\n</message>\n\nEnd of messages.',
                replaceAll: false,
            },
        ],
        expected:
            'Invalid `id` attribute for new `<message>`. The `<message>` `id` attribute is an integer sequence so the next valid `id` is `1`. Try again with `id="1"`.',
    });
});

test("rejects creating messages with a time attribute", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "\n\nEnd of messages.",
                new: '\n\n<message from="[ChatGPT](/bot/chatgpt)" time="3 minutes later">\n\nServer should choose the time.\n\n</message>\n\nEnd of messages.',
                replaceAll: false,
            },
        ],
        expected:
            "You can\u2019t add a `<message>` with a `time` attribute. The creation time of the message will be decided by the server. Try again without the `time` attribute.",
    });
});

test("rejects removing the end marker while creating messages", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [
            {
                old: "\n\nEnd of messages.",
                new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\nMissing end marker.\n\n</message>',
                replaceAll: false,
            },
        ],
        expected:
            "When you\u2019re adding a message you need to keep the \u201CEnd of messages\u201D marker at the end of the message list below your new message. Try again without removing the \u201CEnd of messages\u201D marker.",
    });
});

test("rejects removing the end marker without creating messages", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });

    await expectInvalidUpdateDisplayMessage({
        updates: [{old: "\n\nEnd of messages.", new: "", replaceAll: false}],
        expected:
            "Can\u2019t remove the \u201CEnd of messages\u201D marker in an update. Only a `read` tool call can tell you whether you\u2019re at the end of a message list or not. Try again without removing the \u201CEnd of messages\u201D marker.",
    });
});

test("rejects adding the end marker to a non-final page", async () => {
    const path = `${chatPath}?start`;
    await readChat({path, limit: "1kb", totalMessageCount: 31});

    await expectInvalidUpdateDisplayMessage({
        path,
        updates: [
            {
                old: '<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nMessage 8\n\n</message>',
                new: '<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nMessage 8\n\n</message>\n\nEnd of messages.',
                replaceAll: false,
            },
        ],
        expected:
            "Can\u2019t add the \u201CEnd of messages\u201D marker in an update. Only a `read` tool call can tell you whether you\u2019re at the end of a message list or not. Try again without adding the \u201CEnd of messages\u201D marker.",
    });
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
    ).rejects.toThrow(UnimplementedError);
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
    ).rejects.toThrow(UnimplementedError);
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
    ).rejects.toThrow(UnimplementedError);
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
    ).rejects.toThrow(UnimplementedError);
});

test("throws UnimplementedError when updating and creating messages together", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index =>
            createMessage({index, author: botApiAccount, content: "Bot original"}),
    });
    mockCreateMessages(1);

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
    ).rejects.toThrow(UnimplementedError);

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {
            content: createTextContent("New bot message."),
        },
    ]);
});

test("throws InternalError when updating a cached new message without an id", async () => {
    await readChat({
        totalMessageCount: 1,
        createMessage: index => createMessage({index, content: "Existing message"}),
    });
    mockCreateMessages(1);

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
    ).rejects.toThrow(UnimplementedError);
});
