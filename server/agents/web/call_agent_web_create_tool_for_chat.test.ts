import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {createApiMessageMock} from "~/server/agents/api/test_helpers/create_api_message_mock.js";
import type {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebCreateTool} from "~/server/agents/web/call_agent_web_create_tool.js";
import {callAgentWebUpdateTool} from "~/server/agents/web/call_agent_web_update_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import type {ApiAccount} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    ErrorBase,
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    UnimplementedError,
} from "~/shared/error/error.js";
import type {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import type {AccountId, BotId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const spaceId = generateId<SpaceId>();
const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();

const aliceAccount = createApiAccountMock({name: "Alice"});
const bobAccount = createApiAccountMock({name: "Bob"});
const botApiAccount = createApiAccountMock({
    id: botAccountId,
    name: "ChatGPT",
    botId,
});

const {span} = testTracer.startSpan("call_agent_web_create_tool_chat.test.ts");
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
    const actualAlicePathname = await createAgentWebPageStoredLinkPathname(
        storage,
        intoApiAccountReference(aliceAccount),
    );
    assert(actualAlicePathname === "/human/alice");

    const actualBobPathname = await createAgentWebPageStoredLinkPathname(
        storage,
        intoApiAccountReference(bobAccount),
    );
    assert(actualBobPathname === "/human/bob");

    const actualBotAccountPathname = await createAgentWebPageStoredLinkPathname(
        storage,
        context.botAccount,
    );
    assert(actualBotAccountPathname === context.botAccount.pathname);
});

function createTextContent(text: string): ApiContentResponseWithoutKeys {
    return {elements: [{type: "Paragraph", elements: [{type: "Text", text}]}]};
}

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

async function expectFailedPreconditionDisplayMessage({
    content,
    expected,
}: {
    content: string;
    expected: string;
}) {
    const result = await captureResultPromise(
        async () => await callAgentWebCreateTool(context, {type: "chat", content}),
    );

    if (result.ok) {
        throw new InternalError("Expected create tool call to throw");
    }

    expect(printDisplayMessage(getDisplayMessage(result.error))).toEqual(expected);
    expect(result.error).toBeInstanceOf(FailedPreconditionError);
}

async function expectInvalidCreateDisplayMessage({
    content,
    expected,
}: {
    content: string;
    expected: string;
}) {
    const result = await captureResultPromise(
        async () => await callAgentWebCreateTool(context, {type: "chat", content}),
    );

    if (result.ok) {
        throw new InternalError("Expected create tool call to throw");
    }

    expect(printDisplayMessage(getDisplayMessage(result.error))).toEqual(expected);
    expect(result.error).toBeInstanceOf(InvalidArgumentError);
}

function mockCreateDirectChat({
    id = generateId<ChatId>(),
    title,
    members = [aliceAccount, bobAccount],
}: {
    id?: ChatId;
    title: string;
    members?: ReadonlyArray<ApiAccount>;
}): ChatId {
    api.mockPost("/chats", {
        params: "Any",
        data: {
            spaceId,
            chat: {
                type: "Direct",
                id,
                members: members.map(account => ({account})),
                reference: {title},
            },
        },
    });

    return id;
}

function mockCreateRoomChat({
    id = generateId<ChatId>(),
    name,
}: {
    id?: ChatId;
    name: string;
}): ChatId {
    api.mockPost("/chats", {
        params: "Any",
        data: {
            spaceId,
            chat: {
                type: "Room",
                id,
                name,
            },
        },
    });

    return id;
}

function mockCreateMessages({
    chatId,
    count,
    startIndex = 0,
}: {
    chatId: ChatId;
    count: number;
    startIndex?: number;
}) {
    for (let index = 0; index < count; index++) {
        api.mockPost("/chats/{id}/messages", {
            params: {path: {id: chatId}},
            data: {
                spaceId,
                message: createApiMessageMock({
                    index: startIndex + index,
                    author: botApiAccount,
                    content: "Created message response",
                }),
            },
        });
    }
}

function getCreateChatRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "POST" && request.path === "/chats");
}

function getCreateMessageRequests() {
    return api
        .getRequestHistory()
        .filter(request => request.method === "POST" && request.path === "/chats/{id}/messages");
}

test("creates a direct chat without messages", async () => {
    const chatId = mockCreateDirectChat({title: "Alice and Bob Empty"});

    await expect(
        callAgentWebCreateTool(context, {
            type: "chat",
            content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

End of messages.`,
        }),
    ).resolves.toEqual(
        "Create was successful. New chat: [Alice and Bob Empty](/chat/alice-and-bob-empty).\n",
    );

    expect(getCreateChatRequests()).toMatchObject([
        {
            body: {
                spaceId,
                chat: {
                    type: "Direct",
                    members: [
                        {account: intoApiAccountReference(aliceAccount)},
                        {account: intoApiAccountReference(bobAccount)},
                    ],
                },
            },
        },
    ]);
    expect(getCreateMessageRequests()).toEqual([]);
    expect(await storage.readResponseByPath.get("/chat/alice-and-bob-empty")).toMatchObject({
        pageMetadata: {type: "Chat", id: chatId, messages: []},
    });
});

test("creates a direct chat without messages and without the end of messages mark", async () => {
    const chatId = mockCreateDirectChat({title: "Alice and Bob Empty"});

    await expect(
        callAgentWebCreateTool(context, {
            type: "chat",
            content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).`,
        }),
    ).resolves.toEqual(
        "Create was successful. New chat: [Alice and Bob Empty](/chat/alice-and-bob-empty).\n",
    );

    expect(getCreateChatRequests()).toMatchObject([
        {
            body: {
                spaceId,
                chat: {
                    type: "Direct",
                    members: [
                        {account: intoApiAccountReference(aliceAccount)},
                        {account: intoApiAccountReference(bobAccount)},
                    ],
                },
            },
        },
    ]);
    expect(getCreateMessageRequests()).toEqual([]);
    expect(await storage.readResponseByPath.get("/chat/alice-and-bob-empty")).toMatchObject({
        pageMetadata: {type: "Chat", id: chatId, messages: []},
    });
});

test("creates a direct chat with messages", async () => {
    const chatId = mockCreateDirectChat({title: "Alice and Bob Kickoff"});
    mockCreateMessages({chatId, count: 2});

    await expect(
        callAgentWebCreateTool(context, {
            type: "chat",
            content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message id="0" from="[ChatGPT](/bot/chatgpt)">

I can help coordinate the handoff.

</message>

<message id="1" from="[ChatGPT](/bot/chatgpt)">

I will summarize the open questions next.

</message>

End of messages.`,
        }),
    ).resolves.toEqual(
        "Create was successful. New chat: [Alice and Bob Kickoff](/chat/alice-and-bob-kickoff).\n",
    );

    expect(getCreateChatRequests()).toMatchObject([
        {
            body: {
                spaceId,
                chat: {
                    type: "Direct",
                    members: [
                        {account: intoApiAccountReference(aliceAccount)},
                        {account: intoApiAccountReference(bobAccount)},
                    ],
                },
            },
        },
    ]);
    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {content: createTextContent("I can help coordinate the handoff.")},
        {content: createTextContent("I will summarize the open questions next.")},
    ]);
    expect(await storage.readResponseByPath.get("/chat/alice-and-bob-kickoff")).toMatchObject({
        pageMetadata: {
            type: "Chat",
            id: chatId,
            messages: [{index: 0}, {index: 1}],
        },
    });
});

test("creates a direct chat with messages without the end marker", async () => {
    const chatId = mockCreateDirectChat({title: "Alice and Bob Kickoff"});
    mockCreateMessages({chatId, count: 2});

    await expect(
        callAgentWebCreateTool(context, {
            type: "chat",
            content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message id="0" from="[ChatGPT](/bot/chatgpt)">

I can help coordinate the handoff.

</message>

<message id="1" from="[ChatGPT](/bot/chatgpt)">

I will summarize the open questions next.

</message>`,
        }),
    ).resolves.toEqual(
        "Create was successful. New chat: [Alice and Bob Kickoff](/chat/alice-and-bob-kickoff).\n",
    );

    expect(getCreateChatRequests()).toMatchObject([
        {
            body: {
                spaceId,
                chat: {
                    type: "Direct",
                    members: [
                        {account: intoApiAccountReference(aliceAccount)},
                        {account: intoApiAccountReference(bobAccount)},
                    ],
                },
            },
        },
    ]);
    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {content: createTextContent("I can help coordinate the handoff.")},
        {content: createTextContent("I will summarize the open questions next.")},
    ]);
    expect(await storage.readResponseByPath.get("/chat/alice-and-bob-kickoff")).toMatchObject({
        pageMetadata: {
            type: "Chat",
            id: chatId,
            messages: [{index: 0}, {index: 1}],
        },
    });
});

test("creates a direct chat with messages without the end marker and then message via the update tool", async () => {
    const chatId = mockCreateDirectChat({title: "Alice and Bob Kickoff"});
    mockCreateMessages({chatId, count: 2});

    await expect(
        callAgentWebCreateTool(context, {
            type: "chat",
            content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).`,
        }),
    ).resolves.toEqual(
        "Create was successful. New chat: [Alice and Bob Kickoff](/chat/alice-and-bob-kickoff).\n",
    );

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/chat/alice-and-bob-kickoff",
            updates: [
                {
                    old: "human/bob).",
                    new: `\
human/bob).

<message id="0" from="[ChatGPT](/bot/chatgpt)">

I can help coordinate the handoff.

</message>`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/chat/alice-and-bob-kickoff",
            updates: [
                {
                    old: "</message>",
                    new: `\
</message>

<message id="1" from="[ChatGPT](/bot/chatgpt)">

I will summarize the open questions next.

</message>

End of messages.`,
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getCreateChatRequests()).toMatchObject([
        {
            body: {
                spaceId,
                chat: {
                    type: "Direct",
                    members: [
                        {account: intoApiAccountReference(aliceAccount)},
                        {account: intoApiAccountReference(bobAccount)},
                    ],
                },
            },
        },
    ]);
    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {content: createTextContent("I can help coordinate the handoff.")},
        {content: createTextContent("I will summarize the open questions next.")},
    ]);
    expect(await storage.readResponseByPath.get("/chat/alice-and-bob-kickoff")).toMatchObject({
        pageMetadata: {
            type: "Chat",
            id: chatId,
            messages: [{index: 0}, {index: 1}],
        },
    });
});

test("does not create a chat when a new message is from another account", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message id="0" from="[Alice](/human/alice)">

This should fail validation before creating the chat.

</message>

End of messages.`,
        expected:
            'You can only add a `<message>` from yourself. Try again with a `from` attribute that references yourself (`from="[ChatGPT](/bot/chatgpt)"`).',
    });
    expect(getCreateChatRequests()).toEqual([]);
    expect(getCreateMessageRequests()).toEqual([]);
});

test("does not create a chat when a new message has the wrong id", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message id="3" from="[ChatGPT](/bot/chatgpt)">

This should fail validation before creating the chat.

</message>

End of messages.`,
        expected:
            'Invalid `id` attribute for new `<message>`. The `<message>` `id` attribute is an integer sequence so the next valid `id` is `0`. Try again with `id="0"`.',
    });
    expect(getCreateChatRequests()).toEqual([]);
    expect(getCreateMessageRequests()).toEqual([]);
});

test("does not create a chat when a new message sets time", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message id="0" from="[ChatGPT](/bot/chatgpt)" time="3 minutes later">

This should fail validation before creating the chat.

</message>

End of messages.`,
        expected:
            "You can\u2019t add a `<message>` with a `time` attribute. The creation time of the message will be decided by the server. Try again without the `time` attribute.",
    });
    expect(getCreateChatRequests()).toEqual([]);
    expect(getCreateMessageRequests()).toEqual([]);
});

test("does not create a chat when a reply parent is not found", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message id="0" from="[ChatGPT](/bot/chatgpt)">

<blockquote cite="?message=0">

[Alice](/human/alice): Missing parent message

</blockquote>

Replying to a parent that is not in the new chat.

</message>

End of messages.`,
        expected:
            'Couldn\u2019t find `<message id="0">` referenced by `<blockquote cite="?message=0">` on the current page. To create a message that replies to another message, the cited message must be visible on the current page. If you\u2019re trying to quote a message that\u2019s not on this page then call the `read` tool with a larger `limit` so that the message you\u2019re replying to is on the same page you\u2019re updating. Try again without the `<blockquote>`, with a different `cite` attribute that references a message on the current page, or with a larger limit when calling `read` so the `<message>` you\u2019re replying to is on the same page you\u2019re updating.',
    });
    expect(getCreateChatRequests()).toEqual([]);
    expect(getCreateMessageRequests()).toEqual([]);
});

test("does not create a chat when a later reply parent is not found", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message id="0" from="[ChatGPT](/bot/chatgpt)">

First message should not be partially created.

</message>

<message id="1" from="[ChatGPT](/bot/chatgpt)">

<blockquote cite="?message=0">

[ChatGPT](/bot/chatgpt): Missing parent message

</blockquote>

Replying to a parent that is not in the new chat.

</message>

End of messages.`,
        expected:
            "Couldn\u2019t find the quoted content in `<blockquote>` in the current message page. To create a message that replies to another message you must exactly recreate the content you\u2019re replying to in `<blockquote>` so we can find the corresponding range in the messages on this page. If you\u2019re trying to quote a message that\u2019s not on this page then call the `read` tool with a larger `limit` so that the message you\u2019re replying to is on the same page you\u2019re updating. Formatting is flexible when matching content so `**needle**` will match `**foo needle bar**` and `- needle` will match `- foo needle bar` because `**needle**` and `- needle` correctly match the word \u201cneedle\u201d and have the right formatting. Simply `needle` without formatting will also match `**foo needle bar**` and `- foo needle bar` however `_needle_` will match neither because it has incorrect formatting. Your content in `<blockquote>` must be valid markdown so `**foo needle` won\u2019t match `**foo needle bar**` because the formatting (`**`) is unterminated, either `**foo needle**` or `foo needle` (without formatting) will match. Try again but make sure to exactly copy the content you want to reply to in the current message page into a `<blockquote>`.",
    });
    expect(getCreateChatRequests()).toEqual([]);
    expect(getCreateMessageRequests()).toEqual([]);
});

test("does not create a chat when a reply parent omits the author prefix", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message id="0" from="[ChatGPT](/bot/chatgpt)">

Parent from this create call.

</message>

<message id="1" from="[ChatGPT](/bot/chatgpt)">

<blockquote cite="?message=0">

Parent from this create call.

</blockquote>

Replying without an author prefix.

</message>

End of messages.`,
        expected:
            "`<blockquote>` content on line 11 must start with a link to the message author followed by a colon. For example: `[John](/human/john-doe): quoted text`. Try again with a link to the message author.",
    });
    expect(getCreateChatRequests()).toEqual([]);
    expect(getCreateMessageRequests()).toEqual([]);
});

test("does not create a chat when a reply parent author prefix is wrong", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message id="0" from="[ChatGPT](/bot/chatgpt)">

Parent from this create call.

</message>

<message id="1" from="[ChatGPT](/bot/chatgpt)">

<blockquote cite="?message=0">

[Alice](/human/alice): Parent from this create call.

</blockquote>

Replying with the wrong author prefix.

</message>

End of messages.`,
        expected:
            'The `<blockquote>` content starts with `[Alice](...): `, but `<message id="0">` is from \u201CChatGPT\u201D. Try again with `[ChatGPT](...): ` before any other `<blockquote>` content.',
    });
    expect(getCreateChatRequests()).toEqual([]);
    expect(getCreateMessageRequests()).toEqual([]);
});

test("only searches the cited new message when creating a reply parent", async () => {
    const chatId = mockCreateDirectChat({title: "Alice and Bob Reply"});
    mockCreateMessages({chatId, count: 2});

    await expect(
        callAgentWebCreateTool(context, {
            type: "chat",
            content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message id="0" from="[ChatGPT](/bot/chatgpt)">

Duplicate parent

</message>

<message id="1" from="[ChatGPT](/bot/chatgpt)">

Duplicate parent

</message>

<message id="2" from="[ChatGPT](/bot/chatgpt)">

<blockquote cite="?message=0">

[ChatGPT](/bot/chatgpt): Duplicate parent

</blockquote>

Replying to an ambiguous parent.

</message>

End of messages.`,
        }),
    ).rejects.toThrow(UnimplementedError);

    expect(getCreateChatRequests()).toHaveLength(1);
    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {content: createTextContent("Duplicate parent")},
        {content: createTextContent("Duplicate parent")},
    ]);
});

test("does not create a chat when a new reply parent has multiple matches without match", async () => {
    await expectInvalidCreateDisplayMessage({
        content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message id="0" from="[ChatGPT](/bot/chatgpt)">

needle needle

</message>

<message id="1" from="[ChatGPT](/bot/chatgpt)">

<blockquote cite="?message=0">

[ChatGPT](/bot/chatgpt): needle

</blockquote>

Replying to an ambiguous parent.

</message>

End of messages.`,
        expected:
            '2 matches were found for the quoted content in `<blockquote>` in `<message id="0">`. Try again but provide more surrounding context to make your match unique or add a 1-indexed `match` attribute to `<blockquote>` to choose which match to use (e.g. `<blockquote match="2">` uses the second match).',
    });
    expect(getCreateChatRequests()).toEqual([]);
    expect(getCreateMessageRequests()).toEqual([]);
});

test("uses quote match when creating a reply to repeated new parent content", async () => {
    const chatId = mockCreateDirectChat({title: "Alice and Bob Reply"});
    mockCreateMessages({chatId, count: 1});

    const result = await captureResultPromise(
        async () =>
            await callAgentWebCreateTool(context, {
                type: "chat",
                content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message id="0" from="[ChatGPT](/bot/chatgpt)">

needle needle

</message>

<message id="1" from="[ChatGPT](/bot/chatgpt)">

<blockquote cite="?message=0" match="2">

[ChatGPT](/bot/chatgpt): needle

</blockquote>

Replying to the second match.

</message>

End of messages.`,
            }),
    );

    if (result.ok) {
        throw new InternalError("Expected create tool call to throw");
    }

    expect(result.error).toBeInstanceOf(UnimplementedError);
    expect((result.error as UnimplementedError).cause).toMatchObject({
        cause: {
            startMessageIndex: 0,
            endMessageIndex: 1,
            range: {
                start: {type: "Inline", index: 7},
                end: {type: "Inline", index: 13},
            },
        },
    });
    expect(getCreateChatRequests()).toHaveLength(1);
    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {content: createTextContent("needle needle")},
    ]);
});

test("allows a later new message to quote an earlier new message", async () => {
    const chatId = mockCreateDirectChat({title: "Alice and Bob Reply"});
    mockCreateMessages({chatId, count: 1});

    await expect(
        callAgentWebCreateTool(context, {
            type: "chat",
            content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message id="0" from="[ChatGPT](/bot/chatgpt)">

Parent from this create call.

</message>

<message id="1" from="[ChatGPT](/bot/chatgpt)">

<blockquote cite="?message=0">

[ChatGPT](/bot/chatgpt): Parent from this create call.

</blockquote>

Replying to the message we just created.

</message>

End of messages.`,
        }),
    ).rejects.toThrow(UnimplementedError);

    expect(getCreateChatRequests()).toMatchObject([
        {
            body: {
                spaceId,
                chat: {
                    type: "Direct",
                    members: [
                        {account: intoApiAccountReference(aliceAccount)},
                        {account: intoApiAccountReference(bobAccount)},
                    ],
                },
            },
        },
    ]);
    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {content: createTextContent("Parent from this create call.")},
    ]);
});

test("creates a room chat without messages", async () => {
    const chatId = mockCreateRoomChat({name: "Incident Launch Empty"});

    await expect(
        callAgentWebCreateTool(context, {
            type: "chat",
            content: `\
# Incident Launch Empty

End of messages.`,
        }),
    ).resolves.toEqual(
        "Create was successful. New chat: [Incident Launch Empty](/chat/incident-launch-empty).\n",
    );

    expect(getCreateChatRequests()).toMatchObject([
        {
            body: {
                spaceId,
                chat: {
                    type: "Room",
                    name: "Incident Launch Empty",
                },
            },
        },
    ]);
    expect(getCreateMessageRequests()).toEqual([]);
    expect(await storage.readResponseByPath.get("/chat/incident-launch-empty")).toMatchObject({
        pageMetadata: {type: "Chat", id: chatId, messages: []},
    });
});

test("creates a room chat with messages", async () => {
    const chatId = mockCreateRoomChat({name: "Incident Launch Room"});
    mockCreateMessages({chatId, count: 2});

    await expect(
        callAgentWebCreateTool(context, {
            type: "chat",
            content: `\
# Incident Launch Room

<message id="0" from="[ChatGPT](/bot/chatgpt)">

I opened this room for launch triage.

</message>

<message id="1" from="[ChatGPT](/bot/chatgpt)">

Please post blockers here.

</message>

End of messages.`,
        }),
    ).resolves.toEqual(
        "Create was successful. New chat: [Incident Launch Room](/chat/incident-launch-room).\n",
    );

    expect(getCreateChatRequests()).toMatchObject([
        {
            body: {
                spaceId,
                chat: {
                    type: "Room",
                    name: "Incident Launch Room",
                },
            },
        },
    ]);
    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {content: createTextContent("I opened this room for launch triage.")},
        {content: createTextContent("Please post blockers here.")},
    ]);
    expect(await storage.readResponseByPath.get("/chat/incident-launch-room")).toMatchObject({
        pageMetadata: {
            type: "Chat",
            id: chatId,
            messages: [{index: 0}, {index: 1}],
        },
    });
});

test("creates a room chat with messages without the end marker", async () => {
    const chatId = mockCreateRoomChat({name: "Incident Launch Room"});
    mockCreateMessages({chatId, count: 2});

    await expect(
        callAgentWebCreateTool(context, {
            type: "chat",
            content: `\
# Incident Launch Room

<message id="0" from="[ChatGPT](/bot/chatgpt)">

I opened this room for launch triage.

</message>

<message id="1" from="[ChatGPT](/bot/chatgpt)">

Please post blockers here.

</message>`,
        }),
    ).resolves.toEqual(
        "Create was successful. New chat: [Incident Launch Room](/chat/incident-launch-room).\n",
    );

    expect(getCreateChatRequests()).toMatchObject([
        {
            body: {
                spaceId,
                chat: {
                    type: "Room",
                    name: "Incident Launch Room",
                },
            },
        },
    ]);
    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {content: createTextContent("I opened this room for launch triage.")},
        {content: createTextContent("Please post blockers here.")},
    ]);
    expect(await storage.readResponseByPath.get("/chat/incident-launch-room")).toMatchObject({
        pageMetadata: {
            type: "Chat",
            id: chatId,
            messages: [{index: 0}, {index: 1}],
        },
    });
});

test("updates a created chat to add more messages", async () => {
    const chatId = mockCreateRoomChat({name: "Incident Launch Updates"});
    mockCreateMessages({chatId, count: 1});

    await expect(
        callAgentWebCreateTool(context, {
            type: "chat",
            content: `\
# Incident Launch Updates

<message id="0" from="[ChatGPT](/bot/chatgpt)">

I opened this room for launch triage.

</message>

End of messages.`,
        }),
    ).resolves.toEqual(
        "Create was successful. New chat: [Incident Launch Updates](/chat/incident-launch-updates).\n",
    );

    mockCreateMessages({chatId, count: 2, startIndex: 1});

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/chat/incident-launch-updates",
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message id="1" from="[ChatGPT](/bot/chatgpt)">\n\nI found the first blocker.\n\n</message>\n\n<message id="2" from="[ChatGPT](/bot/chatgpt)">\n\nI will post the next update here.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {content: createTextContent("I opened this room for launch triage.")},
        {content: createTextContent("I found the first blocker.")},
        {content: createTextContent("I will post the next update here.")},
    ]);
    expect(await storage.readResponseByPath.get("/chat/incident-launch-updates")).toMatchObject({
        pageMetadata: {
            type: "Chat",
            id: chatId,
            messages: [{index: 0}, {index: 1}, {index: 2}],
        },
    });
});

test("updates a created chat with messages without ids to add messages without ids", async () => {
    const chatId = mockCreateRoomChat({name: "Incident Launch No Ids"});
    mockCreateMessages({chatId, count: 2});

    await expect(
        callAgentWebCreateTool(context, {
            type: "chat",
            content: `\
# Incident Launch No Ids

<message from="[ChatGPT](/bot/chatgpt)">

I opened this room without an id attribute.

</message>

<message from="[ChatGPT](/bot/chatgpt)">

This second message also has no id attribute.

</message>

End of messages.`,
        }),
    ).resolves.toEqual(
        "Create was successful. New chat: [Incident Launch No Ids](/chat/incident-launch-no-ids).\n",
    );

    mockCreateMessages({chatId, count: 2, startIndex: 2});

    await expect(
        callAgentWebUpdateTool(context, {
            path: "/chat/incident-launch-no-ids",
            updates: [
                {
                    old: "\n\nEnd of messages.",
                    new: '\n\n<message from="[ChatGPT](/bot/chatgpt)">\n\nA third no-id message should append at index two.\n\n</message>\n\n<message from="[ChatGPT](/bot/chatgpt)">\n\nA fourth no-id message should append at index three.\n\n</message>\n\nEnd of messages.',
                    replaceAll: false,
                },
            ],
        }),
    ).resolves.toEqual("Update was successful.\n");

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {content: createTextContent("I opened this room without an id attribute.")},
        {content: createTextContent("This second message also has no id attribute.")},
        {content: createTextContent("A third no-id message should append at index two.")},
        {content: createTextContent("A fourth no-id message should append at index three.")},
    ]);
    expect(await storage.readResponseByPath.get("/chat/incident-launch-no-ids")).toMatchObject({
        pageMetadata: {
            type: "Chat",
            id: chatId,
            messages: [{index: 0}, {index: 1}, {index: 2}, {index: 3}],
        },
    });
});

test("reports unseen messages when creating message in an existing direct chat", async () => {
    const existingChatId = mockCreateDirectChat({title: "Alice and Bob Existing Single"});
    mockCreateMessages({chatId: existingChatId, count: 1, startIndex: 20});

    await expectFailedPreconditionDisplayMessage({
        content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message id="0" from="[ChatGPT](/bot/chatgpt)">

I am following up in the existing direct chat.

</message>

End of messages.`,
        expected:
            "Create was successful. Found chat: [Alice and Bob Existing Single](/chat/alice-and-bob-existing-single). The message you added was created, but a chat with Alice and Bob already existed so your message was added to the end of the existing chat. If you want to see the previous messages in the chat before the new message you added then call the `read` tool with `/chat/alice-and-bob-existing-single?before=20`. (This create was a partial success. Try to figure out which parts of the create were successful before trying again.)",
    });

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {content: createTextContent("I am following up in the existing direct chat.")},
    ]);
});

test("reports unseen messages when creating messages in an existing direct chat", async () => {
    const existingChatId = mockCreateDirectChat({title: "Alice and Bob Existing Multiple"});
    mockCreateMessages({chatId: existingChatId, count: 2, startIndex: 20});

    await expectFailedPreconditionDisplayMessage({
        content: `\
Chat with [Alice](/human/alice) and [Bob](/human/bob).

<message id="0" from="[ChatGPT](/bot/chatgpt)">

I am following up in the existing direct chat.

</message>

<message id="1" from="[ChatGPT](/bot/chatgpt)">

These should land after the existing history.

</message>

End of messages.`,
        expected:
            "Create was successful. Found chat: [Alice and Bob Existing Multiple](/chat/alice-and-bob-existing-multiple). The messages you added were created, but a chat with Alice and Bob already existed so your messages were added to the end of the existing chat. If you want to see the previous messages in the chat before the new messages you added then call the `read` tool with `/chat/alice-and-bob-existing-multiple?before=20`. (This create was a partial success. Try to figure out which parts of the create were successful before trying again.)",
    });

    expect(getCreateMessageRequests().map(request => request.body)).toEqual([
        {content: createTextContent("I am following up in the existing direct chat.")},
        {content: createTextContent("These should land after the existing history.")},
    ]);
});
