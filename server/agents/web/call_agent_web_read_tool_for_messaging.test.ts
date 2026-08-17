// NOTE: We mostly use chats in this file to test general
// `readAgentWebMessagingPage()` and `truncateAgentWebMessagingPage()` behavior
// through `callAgentWebReadTool()`. For chat-specific tests see
// `server/agents/web/call_agent_web_read_tool_chat.test.ts`.

import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {createApiMessageMock} from "~/server/agents/api/test_helpers/create_api_message_mock.js";
import {mockApiGetChat} from "~/server/agents/api/test_helpers/mock_api_get_chat.js";
import {mockApiGetChatMessages} from "~/server/agents/api/test_helpers/mock_api_get_chat_messages.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebReadTool as actuallyCallAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {callAgentWebScrollTool as actuallyCallAgentWebScrollTool} from "~/server/agents/web/call_agent_web_scroll_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {
    ApiContentResponse,
    ApiMessageContentPayloadFileResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertTimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    BotId,
    ChatId,
    DocumentId,
    FileId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

async function callAgentWebReadTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebReadTool>
): Promise<string> {
    const result = await actuallyCallAgentWebReadTool(...callArguments);
    assert(result.response.type === "String");
    return result.response.string;
}

async function callAgentWebScrollTool(
    ...callArguments: Parameters<typeof actuallyCallAgentWebScrollTool>
): Promise<string> {
    return (await actuallyCallAgentWebScrollTool(...callArguments)).response;
}

const spaceId = generateId<SpaceId>();
const chatId = generateId<ChatId>();

const aliceAccount = createApiAccountMock({name: "Alice"});
const bobAccount = createApiAccountMock({name: "Bob"});
const author = [aliceAccount, bobAccount];

const {span} = testTracer.startSpan("call_agent_web_read_tool_messaging.test.ts");
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
    const actualBotAccountPathname = await storeAgentWebPageLinkForTest(storage, {
        type: "Account",
        id: context.botAccount.id,
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: context.botAccount.bot,
    });
    assert(actualBotAccountPathname === "/bot/chatgpt");

    const chatPathname = await storeAgentWebPageLinkForTest(storage, {
        type: "Chat",
        id: chatId,
        title: "Incident Response",
    });
    assert(chatPathname === "/chat/incident-response");
});

// Simple stable pseudo random number generator that will always return 0 or 1.
function stableRandomBit(index: number): number {
    index = Math.imul(index ^ (index >>> 16), 0x45d9f3b);
    index = Math.imul(index ^ (index >>> 16), 0x45d9f3b);
    return (index ^ (index >>> 16)) >>> 31;
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

test("prints bot messages with bot `from` path", async () => {
    const assistantAccount = createApiAccountMock({
        name: "Assistant",
        botId: generateId<BotId>(),
    });

    mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
    mockApiGetChatMessages(api, {
        spaceId,
        chatId,
        from: "End",
        totalMessageCount: 1,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author: assistantAccount, content: "Hello human!"}),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit: "10kb",
        }),
    ).toEqual(`\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Assistant](/bot/assistant)">

Hello human!

</message>

End of messages.`);
});

test("prints message files at the end and splits following messages", async () => {
    mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
    mockApiGetChatMessages(api, {
        spaceId,
        chatId,
        from: "End",
        totalMessageCount: 3,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: aliceAccount,
                content:
                    index === 0
                        ? "First message."
                        : index === 1
                          ? "Second message."
                          : "Third message.",
                createdTime: new Date(Date.UTC(2026, 4, 14, 15, index * 2)),
                files: index === 1 ? createImageMessageFiles(3) : [],
            }),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit: "10kb",
        }),
    ).toEqual(`\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0-1" from="[Alice](/human/alice)">

First message.

Second message.

<div style="display: flex">
<img src="/file/image.png" />
<img src="/file/image-2.png" />
<img src="/file/image-3.png" />
</div>

</message>

<message id="2" from="[Alice](/human/alice)">

Third message.

</message>

End of messages.`);
});

test("prints a message with one file", async () => {
    mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
    mockApiGetChatMessages(api, {
        spaceId,
        chatId,
        from: "End",
        totalMessageCount: 1,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: aliceAccount,
                content: "Message with files.",
                createdTime: new Date(Date.UTC(2026, 4, 14, 15)),
                files: createImageMessageFiles(1),
            }),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit: "10kb",
        }),
    ).toEqual(`\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Message with files.

![](/file/image.png)

</message>

End of messages.`);
});

test("prints a message with four files", async () => {
    mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
    mockApiGetChatMessages(api, {
        spaceId,
        chatId,
        from: "End",
        totalMessageCount: 1,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: aliceAccount,
                content: "Message with files.",
                createdTime: new Date(Date.UTC(2026, 4, 14, 15)),
                files: createImageMessageFiles(4),
            }),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit: "10kb",
        }),
    ).toEqual(`\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Message with files.

<div style="display: flex">
<img src="/file/image.png" />
<img src="/file/image-2.png" />
<img src="/file/image-3.png" />
</div>

![](/file/image-4.png)

</message>

End of messages.`);
});

test("prints a message with five files", async () => {
    mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
    mockApiGetChatMessages(api, {
        spaceId,
        chatId,
        from: "End",
        totalMessageCount: 1,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: aliceAccount,
                content: "Message with files.",
                createdTime: new Date(Date.UTC(2026, 4, 14, 15)),
                files: createImageMessageFiles(5),
            }),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit: "10kb",
        }),
    ).toEqual(`\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Message with files.

<div style="display: flex">
<img src="/file/image.png" />
<img src="/file/image-2.png" />
<img src="/file/image-3.png" />
</div>

<div style="display: flex">
<img src="/file/image-4.png" />
<img src="/file/image-5.png" />
</div>

</message>

End of messages.`);
});

test("prints a message with six files", async () => {
    mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
    mockApiGetChatMessages(api, {
        spaceId,
        chatId,
        from: "End",
        totalMessageCount: 1,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: aliceAccount,
                content: "Message with files.",
                createdTime: new Date(Date.UTC(2026, 4, 14, 15)),
                files: createImageMessageFiles(6),
            }),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit: "10kb",
        }),
    ).toEqual(`\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Message with files.

<div style="display: flex">
<img src="/file/image.png" />
<img src="/file/image-2.png" />
<img src="/file/image-3.png" />
</div>

<div style="display: flex">
<img src="/file/image-4.png" />
<img src="/file/image-5.png" />
<img src="/file/image-6.png" />
</div>

</message>

End of messages.`);
});

test("escapes author names in message tags", async () => {
    const apostrophe = String.fromCharCode(39);
    const doubleQuote = String.fromCharCode(34);
    const escapingAccount = createApiAccountMock({
        name: `Alice & Bob${apostrophe}s ${doubleQuote}Bot${doubleQuote}`,
        botId: generateId<BotId>(),
    });

    mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
    mockApiGetChatMessages(api, {
        spaceId,
        chatId,
        from: "End",
        totalMessageCount: 1,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({index, author: escapingAccount, content: "Hello"}),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit: "10kb",
        }),
    ).toEqual(`\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/bot/alice-and-bobs-bot)">

Hello

</message>

End of messages.`);
});

test("prints rich message content using agent web markdown links", async () => {
    const documentId = generateId<DocumentId>();
    const content: ApiContentResponse = addKeysToApiContentForTest({
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Review "},
                    {type: "Text", text: "carefully", marks: [{type: "Bold"}]},
                    {type: "Text", text: " in "},
                    {
                        type: "Mention",
                        reference: {type: "Document", id: documentId, title: "Release Plan"},
                    },
                    {type: "Text", text: " before running "},
                    {type: "Text", text: "deploy", marks: [{type: "Code"}]},
                    {type: "Text", text: "."},
                ],
            },
        ],
    });

    mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
    mockApiGetChatMessages(api, {
        spaceId,
        chatId,
        from: "End",
        totalMessageCount: 1,
        limit: 30,
        createMessage: index => createApiMessageMock({index, author: aliceAccount, content}),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit: "10kb",
        }),
    ).toEqual(`\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Review **carefully** in [Release Plan](/document/release-plan) before running \`deploy\`.

</message>

End of messages.`);
});

test("prints timezone attributes when human message timezones differ from context", async () => {
    mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
    mockApiGetChatMessages(api, {
        spaceId,
        chatId,
        from: "End",
        totalMessageCount: 1,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: aliceAccount,
                createdTimeZone: assertTimeZone("America/Los_Angeles"),
                content: "Hello from the west coast.",
            }),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit: "10kb",
        }),
    ).toEqual(`\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)" timezone="PDT">

Hello from the west coast.

</message>

End of messages.`);
});

test("omits timezone attributes for bot messages", async () => {
    const assistantAccount = createApiAccountMock({
        name: "Assistant",
        botId: generateId<BotId>(),
    });

    mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
    mockApiGetChatMessages(api, {
        spaceId,
        chatId,
        from: "End",
        totalMessageCount: 1,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: assistantAccount,
                createdTimeZone: assertTimeZone("America/Los_Angeles"),
                content: "I keep bot messages timezone-free.",
            }),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit: "10kb",
        }),
    ).toEqual(`\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Assistant](/bot/assistant)">

I keep bot messages timezone-free.

</message>

End of messages.`);
});

test("prints reply previews in blockquotes", async () => {
    mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
    mockApiGetChatMessages(api, {
        spaceId,
        chatId,
        from: "End",
        totalMessageCount: 1,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: bobAccount,
                createdTime: "2026-05-14T15:05:00.000Z",
                parent: {
                    author: aliceAccount,
                    index: 4,
                    endIndex: 7,
                    contentSnippet: "Can you review the rollout?",
                },
                content: "Taking a look now.",
            }),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit: "10kb",
        }),
    ).toEqual(`\
# Incident Response

<time>May 14th at 11:05am EDT</time>

<message id="0" from="[Bob](/human/bob)">

<blockquote cite="?message=4-7">

[Alice](/human/alice): Can you review the rollout?

</blockquote>

Taking a look now.

</message>

End of messages.`);
});

test("marks truncated reply previews with an ellipsis", async () => {
    mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
    mockApiGetChatMessages(api, {
        spaceId,
        chatId,
        from: "End",
        totalMessageCount: 1,
        limit: 30,
        createMessage: index =>
            createApiMessageMock({
                index,
                author: bobAccount,
                createdTime: "2026-05-14T15:05:00.000Z",
                parent: {
                    author: aliceAccount,
                    index: 0,
                    contentSnippet: {
                        elements: [{type: "Text", text: "Can you review"}],
                        isTruncated: true,
                    },
                },
                content: "Taking a look now.",
            }),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit: "10kb",
        }),
    ).toEqual(`\
# Incident Response

<time>May 14th at 11:05am EDT</time>

<message id="0" from="[Bob](/human/bob)">

<blockquote cite="?message=0">

[Alice](/human/alice): Can you review \\[…]

</blockquote>

Taking a look now.

</message>

End of messages.`);
});

test("prints deleted messages", async () => {
    mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
    mockApiGetChatMessages(api, {
        spaceId,
        chatId,
        from: "End",
        totalMessageCount: 2,
        limit: 30,
        createMessage: index => ({
            ...createApiMessageMock({
                index,
                author: aliceAccount,
                createdTimeZone:
                    index === 0 ? defaultTimeZone : assertTimeZone("America/Los_Angeles"),
            }),
            payload: {type: "Deleted" as const},
        }),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit: "10kb",
        }),
    ).toEqual(`\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)" deleted></message>

<message id="1" from="[Alice](/human/alice)" deleted time="5 minutes later" timezone="PDT"></message>

End of messages.`);
});

test("throws on invalid pagination search parameters", async () => {
    const queries = [
        "before=abc",
        "before",
        "after=-01",
        "after=01",
        "message=abc",
        "message=7-4",
        "start=0",
        "end=0",
        "from",
        "from=Start",
        "from=side",
        "from=start",
        "before=3&after=4",
        "before=3&from=start",
        "after=4&from=end",
        "start&from=start",
        "before=3&after=4&message=2&from=start",
        "start&end",
    ] as const;

    const responses: Array<string> = [];

    for (const query of queries) {
        mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
        responses.push(
            await callAgentWebReadTool(context, {
                path: `/chat/incident-response?${query}`,
                limit: "10kb",
            }),
        );
    }

    expect(responses).toEqual([
        "Error: Couldn\u2019t read `/chat/incident-response?before=abc`. Expected `?before` URL search param to be an integer, but got `abc`. Try again with an integer or try omitting `?before`. We recommend using a value for `?before` from a `<message>`\u2019s `id` attribute.",
        "Error: Couldn\u2019t read `/chat/incident-response?before`. Expected `?before` URL search param to be an integer, but got empty. Try again with an integer or try omitting `?before`. We recommend using a value for `?before` from a `<message>`\u2019s `id` attribute.",
        "Error: Couldn\u2019t read `/chat/incident-response?after=-01`. Expected `?after` URL search param to be an integer, but got `-01`. Try again with an integer or try omitting `?after`. We recommend using a value for `?after` from a `<message>`\u2019s `id` attribute.",
        "Error: Couldn\u2019t read `/chat/incident-response?after=01`. Expected `?after` URL search param to be an integer, but got `01`. Try again with an integer or try omitting `?after`. We recommend using a value for `?after` from a `<message>`\u2019s `id` attribute.",
        "Error: Couldn\u2019t read `/chat/incident-response?message=abc`. Expected `?message` URL search param to be an integer or integer range, but got `abc`. Try again with an integer, an integer range, or try omitting `?message`. We recommend using a value for `?message` from a `<message>`\u2019s `id` attribute.",
        "Error: Couldn\u2019t read `/chat/incident-response?message=7-4`. Expected `?message` URL search param to be an integer or integer range, but got `7-4`. Try again with an integer, an integer range, or try omitting `?message`. We recommend using a value for `?message` from a `<message>`\u2019s `id` attribute.",
        "Error: Couldn\u2019t read `/chat/incident-response?start=0`. Expected `?start` URL search param to not have a value, but got `0`. Try again without a value (no `?start=...`, just `?start`).",
        "Error: Couldn\u2019t read `/chat/incident-response?end=0`. Expected `?end` URL search param to not have a value, but got `0`. Try again without a value (no `?end=...`, just `?end`).",
        "Error: Couldn\u2019t read `/chat/incident-response?from`. Expected `?from` URL search param to be either `start` or `end`, but got empty. Try again with `?from=start`, `?from=end`, or try omitting `?from`.",
        "Error: Couldn\u2019t read `/chat/incident-response?from=Start`. Expected `?from` URL search param to be either `start` or `end`, but got `Start`. Try again with `?from=start`, `?from=end`, or try omitting `?from`.",
        "Error: Couldn\u2019t read `/chat/incident-response?from=side`. Expected `?from` URL search param to be either `start` or `end`, but got `side`. Try again with `?from=start`, `?from=end`, or try omitting `?from`.",
        "Error: Couldn\u2019t read `/chat/incident-response?from=start`. Expected a `?before` or an `?after` URL search param when `?from` is present. Try again with a `?before` or `?after` URL search param, or try omitting `?from`.",
        "Error: Couldn\u2019t read `/chat/incident-response?before=3&after=4`. Expected a `?from` URL search param when both `?before` and `?after` are present. Try again with either `?from=start` or `?from=end`.",
        "Error: Couldn\u2019t read `/chat/incident-response?before=3&from=start`. Expected `?from=end` when the `?before` URL search param is present without `?after`. Try again with `?from=end` or try omitting `?from`.",
        "Error: Couldn\u2019t read `/chat/incident-response?after=4&from=end`. Expected `?from=start` when the `?after` URL search param is present without `?before`. Try again with `?from=start` or try omitting `?from`.",
        "Error: Couldn\u2019t read `/chat/incident-response?start&from=start`. Expected only one of `?before`, `?after`, `?message`, `?start`, or `?end` URL search params. Try again with only one of `?before`, `?after`, `?message`, `?start`, or `?end`. We recommend using a value for `?before`, `?after`, or `?message` from a `<message>`\u2019s `id` attribute. (You may use `?before` and `?after` together as long as you provide `?from=start` or `?from=end` as well.)",
        "Error: Couldn\u2019t read `/chat/incident-response?before=3&after=4&message=2&from=start`. Expected only one of `?before`, `?after`, `?message`, `?start`, or `?end` URL search params. Try again with only one of `?before`, `?after`, `?message`, `?start`, or `?end`. We recommend using a value for `?before`, `?after`, or `?message` from a `<message>`\u2019s `id` attribute. (You may use `?before` and `?after` together as long as you provide `?from=start` or `?from=end` as well.)",
        "Error: Couldn\u2019t read `/chat/incident-response?start&end`. Expected only one of `?before`, `?after`, `?message`, `?start`, or `?end` URL search params. Try again with only one of `?before`, `?after`, `?message`, `?start`, or `?end`. We recommend using a value for `?before`, `?after`, or `?message` from a `<message>`\u2019s `id` attribute. (You may use `?before` and `?after` together as long as you provide `?from=start` or `?from=end` as well.)",
    ]);
});

test("caches the full chat read response for scroll", async () => {
    const content: ApiContentResponse = addKeysToApiContentForTest({
        elements: Array.from({length: 10}, (_, index) => ({
            type: "Paragraph",
            elements: [{type: "Text", text: `Paragraph ${index + 1}.`}],
        })),
    });

    mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
    mockApiGetChatMessages(api, {
        spaceId,
        chatId,
        from: "End",
        totalMessageCount: 1,
        limit: 30,
        createMessage: index => createApiMessageMock({index, author: aliceAccount, content}),
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/chat/incident-response",
            limit: "154b",
        }),
    ).toEqual(`\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Paragraph 1.

Paragraph 2.

Paragraph 3.

(Page truncated, 127b remaining. Showing lines 1-12 of 29. Call the \`scroll\` tool with an \`offset\` of 12 to continue.)`);

    expect(
        await callAgentWebScrollTool(context, {
            path: "/chat/incident-response",
            offset: 12,
            limit: "10kb",
        }),
    ).toEqual(`\
Paragraph 4.

Paragraph 5.

Paragraph 6.

Paragraph 7.

Paragraph 8.

Paragraph 9.

Paragraph 10.

</message>

End of messages.

(End of file. Showing lines 13-29 of 29.)`);
});

describe("pagination and truncation", () => {
    test.each([
        {
            limit: "500b",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=87)

<time>May 14th at 6:15pm EDT</time>

<message id="87" from="[Bob](/human/bob)">

Test message 87

</message>

<message id="88" from="[Alice](/human/alice)" time="5 minutes later">

Test message 88

</message>

<message id="89" from="[Bob](/human/bob)" time="5 minutes later">

Test message 89

</message>

End of messages.`,
        },
        {
            limit: "750b",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=84)

<time>May 14th at 6:00pm EDT</time>

<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            limit: "3.034kb",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=61)

<time>May 14th at 4:05pm EDT</time>

<message id="61" from="[Bob](/human/bob)">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            limit: "3.045kb",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=60)

<time>May 14th at 4:00pm EDT</time>

<message id="60" from="[Alice](/human/alice)">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
    ])("reads messages from end with one request (limit: $limit)", async ({limit, response}) => {
        mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

        mockApiGetChatMessages(api, {
            spaceId,
            chatId,
            from: "End",
            totalMessageCount: 90,
            limit: 30,
            createMessage: index => createApiMessageMock({index, author}),
        });

        expect(
            await callAgentWebReadTool(context, {
                path: "/chat/incident-response",
                limit,
            }),
        ).toEqual(response);
    });

    test.each([
        {
            limit: "500b",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=3)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Test message 0

</message>

<message id="1" from="[Bob](/human/bob)" time="5 minutes later">

Test message 1

</message>

<message id="2" from="[Alice](/human/alice)" time="5 minutes later">

Test message 2

</message>

<message id="3" from="[Bob](/human/bob)" time="5 minutes later">

Test message 3

</message>`,
        },
        {
            limit: "750b",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=5)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>`,
        },
        {
            limit: "3kb",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=28)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>`,
        },
        {
            limit: "3.003kb",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=29)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>`,
        },
    ])("reads messages from start with one request (limit: $limit)", async ({limit, response}) => {
        mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

        mockApiGetChatMessages(api, {
            spaceId,
            chatId,
            totalMessageCount: 90,
            limit: 30,
            createMessage: index => createApiMessageMock({index, author}),
        });

        expect(
            await callAgentWebReadTool(context, {
                path: "/chat/incident-response?start",
                limit,
            }),
        ).toEqual(response);
    });

    test.each([
        {
            limit: "500b",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=17)

<time>May 14th at 12:25pm EDT</time>

<message id="17" from="[Bob](/human/bob)">

Test message 17

</message>

<message id="18" from="[Alice](/human/alice)" time="5 minutes later">

Test message 18

</message>

<message id="19" from="[Bob](/human/bob)" time="5 minutes later">

Test message 19

</message>

End of messages.`,
        },
        {
            limit: "750b",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=14)

<time>May 14th at 12:10pm EDT</time>

<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>

End of messages.`,
        },
        {
            limit: "3.06kb",
            response: `\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>

End of messages.`,
        },
    ])(
        "reads messages in small room from end with one request (limit: $limit)",
        async ({limit, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            mockApiGetChatMessages(api, {
                spaceId,
                chatId,
                from: "End",
                totalMessageCount: 20,
                limit: 30,
                createMessage: index => createApiMessageMock({index, author}),
            });

            expect(
                await callAgentWebReadTool(context, {
                    path: "/chat/incident-response",
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            limit: "500b",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=3)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Test message 0

</message>

<message id="1" from="[Bob](/human/bob)" time="5 minutes later">

Test message 1

</message>

<message id="2" from="[Alice](/human/alice)" time="5 minutes later">

Test message 2

</message>

<message id="3" from="[Bob](/human/bob)" time="5 minutes later">

Test message 3

</message>`,
        },
        {
            limit: "750b",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=5)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>`,
        },
        {
            limit: "3.06kb",
            response: `\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>

End of messages.`,
        },
    ])(
        "reads messages in small room from start with one request (limit: $limit)",
        async ({limit, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            mockApiGetChatMessages(api, {
                spaceId,
                chatId,
                totalMessageCount: 20,
                limit: 30,
                createMessage: index => createApiMessageMock({index, author}),
            });

            expect(
                await callAgentWebReadTool(context, {
                    path: "/chat/incident-response?start",
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            limit: "2.874kb",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=1)

<time>May 14th at 11:05am EDT</time>

<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>

End of messages.`,
        },
        {
            limit: "2.90kb",
            response: `\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>

End of messages.`,
        },
    ])(
        "page ends right near the limit boundary when reading from end (limit: $limit)",
        async ({limit, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            mockApiGetChatMessages(api, {
                spaceId,
                chatId,
                from: "End",
                totalMessageCount: 29,
                limit: 30,
                createMessage: index => createApiMessageMock({index, author}),
            });

            expect(
                await callAgentWebReadTool(context, {
                    path: "/chat/incident-response",
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            limit: "2.874kb",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=27)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>`,
        },
        {
            limit: "2.90kb",
            response: `\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>

End of messages.`,
        },
    ])(
        "page ends right near the limit boundary when reading from start (limit: $limit)",
        async ({limit, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            mockApiGetChatMessages(api, {
                spaceId,
                chatId,
                totalMessageCount: 29,
                limit: 30,
                createMessage: index => createApiMessageMock({index, author}),
            });

            expect(
                await callAgentWebReadTool(context, {
                    path: "/chat/incident-response?start",
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            requestCount: 2,
            limit: "5kb",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=41)

<time>May 14th at 2:25pm EDT</time>

<message id="41" from="[Bob](/human/bob)">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            requestCount: 2,
            limit: "5.985kb",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=30)

<time>May 14th at 1:30pm EDT</time>

<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            requestCount: 3,
            limit: "6.984kb",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=21)

<time>May 14th at 12:45pm EDT</time>

<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            requestCount: 3,
            limit: "10kb",
            response: `\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
    ])(
        "reads messages from end with multiple requests (requests: $requestCount)",
        async ({requestCount, limit, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            mockApiGetChatMessages(api, {
                spaceId,
                chatId,
                from: "End",
                totalMessageCount: 90,
                limit: 30,
                createMessage: index => createApiMessageMock({index, author}),
            });

            if (requestCount >= 2) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    from: "End",
                    totalMessageCount: 90,
                    limit: 30,
                    cursor: 60,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            if (requestCount >= 3) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    from: "End",
                    totalMessageCount: 90,
                    limit: 30,
                    cursor: 30,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path: "/chat/incident-response",
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            requestCount: 2,
            limit: "5kb",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=49)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>`,
        },
        {
            requestCount: 2,
            limit: "5.943kb",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=59)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>`,
        },
        {
            requestCount: 3,
            limit: "7.5kb",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=74)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>`,
        },
        {
            requestCount: 3,
            limit: "10kb",
            response: `\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
    ])(
        "reads messages from start with multiple requests (requests: $requestCount)",
        async ({requestCount, limit, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            mockApiGetChatMessages(api, {
                spaceId,
                chatId,
                totalMessageCount: 90,
                limit: 30,
                createMessage: index => createApiMessageMock({index, author}),
            });

            if (requestCount >= 2) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    limit: 30,
                    cursor: 29,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            if (requestCount >= 3) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    limit: 30,
                    cursor: 59,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path: "/chat/incident-response?start",
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            requestCount: 1,
            before: 60,
            cursors: [60],
            limit: "500b",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=57)

<time>May 14th at 3:45pm EDT</time>

<message id="57" from="[Bob](/human/bob)">

Test message 57

</message>

<message id="58" from="[Alice](/human/alice)" time="5 minutes later">

Test message 58

</message>

<message id="59" from="[Bob](/human/bob)" time="5 minutes later">

Test message 59

</message>`,
        },
        {
            requestCount: 1,
            before: 60,
            cursors: [60],
            limit: "750b",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=54)

<time>May 14th at 3:30pm EDT</time>

<message id="54" from="[Alice](/human/alice)">

Test message 54

</message>

<message id="55" from="[Bob](/human/bob)" time="5 minutes later">

Test message 55

</message>

<message id="56" from="[Alice](/human/alice)" time="5 minutes later">

Test message 56

</message>

<message id="57" from="[Bob](/human/bob)" time="5 minutes later">

Test message 57

</message>

<message id="58" from="[Alice](/human/alice)" time="5 minutes later">

Test message 58

</message>

<message id="59" from="[Bob](/human/bob)" time="5 minutes later">

Test message 59

</message>`,
        },
        {
            requestCount: 1,
            before: 60,
            cursors: [60],
            limit: "3.027kb",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=30)

<time>May 14th at 1:30pm EDT</time>

<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>`,
        },
        {
            requestCount: 2,
            before: 60,
            cursors: [60, 30],
            limit: "3.984kb",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=21)

<time>May 14th at 12:45pm EDT</time>

<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>`,
        },
    ])(
        "reads messages before a cursor with pagination (requests: $requestCount, limit: $limit)",
        async ({before, cursors, limit, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const cursor of cursors) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    from: "End",
                    totalMessageCount: 90,
                    limit: 30,
                    cursor,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path: "/chat/incident-response?before=" + before,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            requestCount: 1,
            after: 29,
            cursors: [29],
            limit: "500b",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=33)

<time>May 14th at 1:30pm EDT</time>

<message id="30" from="[Alice](/human/alice)">

Test message 30

</message>

<message id="31" from="[Bob](/human/bob)" time="5 minutes later">

Test message 31

</message>

<message id="32" from="[Alice](/human/alice)" time="5 minutes later">

Test message 32

</message>

<message id="33" from="[Bob](/human/bob)" time="5 minutes later">

Test message 33

</message>`,
        },
        {
            requestCount: 1,
            after: 29,
            cursors: [29],
            limit: "750b",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=35)

<time>May 14th at 1:30pm EDT</time>

<message id="30" from="[Alice](/human/alice)">

Test message 30

</message>

<message id="31" from="[Bob](/human/bob)" time="5 minutes later">

Test message 31

</message>

<message id="32" from="[Alice](/human/alice)" time="5 minutes later">

Test message 32

</message>

<message id="33" from="[Bob](/human/bob)" time="5 minutes later">

Test message 33

</message>

<message id="34" from="[Alice](/human/alice)" time="5 minutes later">

Test message 34

</message>

<message id="35" from="[Bob](/human/bob)" time="5 minutes later">

Test message 35

</message>`,
        },
        {
            requestCount: 1,
            after: 29,
            cursors: [29],
            limit: "3.022kb",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=59)

<time>May 14th at 1:30pm EDT</time>

<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>`,
        },
        {
            requestCount: 2,
            after: 29,
            cursors: [29, 59],
            limit: "4.984kb",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=78)

<time>May 14th at 1:30pm EDT</time>

<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>`,
        },
    ])(
        "reads messages after a cursor with pagination (requests: $requestCount, limit: $limit)",
        async ({after, cursors, limit, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const cursor of cursors) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    limit: 30,
                    cursor,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path: "/chat/incident-response?after=" + after,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            limit: "500b",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=87)

<time>May 18th at 2:00am EDT</time>

<message id="87" from="[Bob](/human/bob)">

Test message 87

</message>

<time>May 18th at 3:00am EDT</time>

<message id="88" from="[Alice](/human/alice)">

Test message 88

</message>

<time>May 18th at 4:00am EDT</time>

<message id="89" from="[Bob](/human/bob)">

Test message 89

</message>

End of messages.`,
        },
        {
            limit: "750b",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=85)

<time>May 18th at 12:00am EDT</time>\n
<message id="85" from="[Bob](/human/bob)">\n\nTest message 85\n\n</message>\n
<time>May 18th at 1:00am EDT</time>\n
<message id="86" from="[Alice](/human/alice)">\n\nTest message 86\n\n</message>\n
<time>May 18th at 2:00am EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<time>May 18th at 3:00am EDT</time>\n
<message id="88" from="[Alice](/human/alice)">\n\nTest message 88\n\n</message>\n
<time>May 18th at 4:00am EDT</time>\n
<message id="89" from="[Bob](/human/bob)">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            limit: "3.454kb",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=61)

<time>May 17th at 12:00am EDT</time>\n
<message id="61" from="[Bob](/human/bob)">\n\nTest message 61\n\n</message>\n
<time>May 17th at 1:00am EDT</time>\n
<message id="62" from="[Alice](/human/alice)">\n\nTest message 62\n\n</message>\n
<time>May 17th at 2:00am EDT</time>\n
<message id="63" from="[Bob](/human/bob)">\n\nTest message 63\n\n</message>\n
<time>May 17th at 3:00am EDT</time>\n
<message id="64" from="[Alice](/human/alice)">\n\nTest message 64\n\n</message>\n
<time>May 17th at 4:00am EDT</time>\n
<message id="65" from="[Bob](/human/bob)">\n\nTest message 65\n\n</message>\n
<time>May 17th at 5:00am EDT</time>\n
<message id="66" from="[Alice](/human/alice)">\n\nTest message 66\n\n</message>\n
<time>May 17th at 6:00am EDT</time>\n
<message id="67" from="[Bob](/human/bob)">\n\nTest message 67\n\n</message>\n
<time>May 17th at 7:00am EDT</time>\n
<message id="68" from="[Alice](/human/alice)">\n\nTest message 68\n\n</message>\n
<time>May 17th at 8:00am EDT</time>\n
<message id="69" from="[Bob](/human/bob)">\n\nTest message 69\n\n</message>\n
<time>May 17th at 9:00am EDT</time>\n
<message id="70" from="[Alice](/human/alice)">\n\nTest message 70\n\n</message>\n
<time>May 17th at 10:00am EDT</time>\n
<message id="71" from="[Bob](/human/bob)">\n\nTest message 71\n\n</message>\n
<time>May 17th at 11:00am EDT</time>\n
<message id="72" from="[Alice](/human/alice)">\n\nTest message 72\n\n</message>\n
<time>May 17th at 12:00pm EDT</time>\n
<message id="73" from="[Bob](/human/bob)">\n\nTest message 73\n\n</message>\n
<time>May 17th at 1:00pm EDT</time>\n
<message id="74" from="[Alice](/human/alice)">\n\nTest message 74\n\n</message>\n
<time>May 17th at 2:00pm EDT</time>\n
<message id="75" from="[Bob](/human/bob)">\n\nTest message 75\n\n</message>\n
<time>May 17th at 3:00pm EDT</time>\n
<message id="76" from="[Alice](/human/alice)">\n\nTest message 76\n\n</message>\n
<time>May 17th at 4:00pm EDT</time>\n
<message id="77" from="[Bob](/human/bob)">\n\nTest message 77\n\n</message>\n
<time>May 17th at 5:00pm EDT</time>\n
<message id="78" from="[Alice](/human/alice)">\n\nTest message 78\n\n</message>\n
<time>May 17th at 6:00pm EDT</time>\n
<message id="79" from="[Bob](/human/bob)">\n\nTest message 79\n\n</message>\n
<time>May 17th at 7:00pm EDT</time>\n
<message id="80" from="[Alice](/human/alice)">\n\nTest message 80\n\n</message>\n
<time>May 17th at 8:00pm EDT</time>\n
<message id="81" from="[Bob](/human/bob)">\n\nTest message 81\n\n</message>\n
<time>May 17th at 9:00pm EDT</time>\n
<message id="82" from="[Alice](/human/alice)">\n\nTest message 82\n\n</message>\n
<time>May 17th at 10:00pm EDT</time>\n
<message id="83" from="[Bob](/human/bob)">\n\nTest message 83\n\n</message>\n
<time>May 17th at 11:00pm EDT</time>\n
<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<time>May 18th at 12:00am EDT</time>\n
<message id="85" from="[Bob](/human/bob)">\n\nTest message 85\n\n</message>\n
<time>May 18th at 1:00am EDT</time>\n
<message id="86" from="[Alice](/human/alice)">\n\nTest message 86\n\n</message>\n
<time>May 18th at 2:00am EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<time>May 18th at 3:00am EDT</time>\n
<message id="88" from="[Alice](/human/alice)">\n\nTest message 88\n\n</message>\n
<time>May 18th at 4:00am EDT</time>\n
<message id="89" from="[Bob](/human/bob)">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            limit: "3.459kb",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=60)

<time>May 16th at 11:00pm EDT</time>\n
<message id="60" from="[Alice](/human/alice)">\n\nTest message 60\n\n</message>\n
<time>May 17th at 12:00am EDT</time>\n
<message id="61" from="[Bob](/human/bob)">\n\nTest message 61\n\n</message>\n
<time>May 17th at 1:00am EDT</time>\n
<message id="62" from="[Alice](/human/alice)">\n\nTest message 62\n\n</message>\n
<time>May 17th at 2:00am EDT</time>\n
<message id="63" from="[Bob](/human/bob)">\n\nTest message 63\n\n</message>\n
<time>May 17th at 3:00am EDT</time>\n
<message id="64" from="[Alice](/human/alice)">\n\nTest message 64\n\n</message>\n
<time>May 17th at 4:00am EDT</time>\n
<message id="65" from="[Bob](/human/bob)">\n\nTest message 65\n\n</message>\n
<time>May 17th at 5:00am EDT</time>\n
<message id="66" from="[Alice](/human/alice)">\n\nTest message 66\n\n</message>\n
<time>May 17th at 6:00am EDT</time>\n
<message id="67" from="[Bob](/human/bob)">\n\nTest message 67\n\n</message>\n
<time>May 17th at 7:00am EDT</time>\n
<message id="68" from="[Alice](/human/alice)">\n\nTest message 68\n\n</message>\n
<time>May 17th at 8:00am EDT</time>\n
<message id="69" from="[Bob](/human/bob)">\n\nTest message 69\n\n</message>\n
<time>May 17th at 9:00am EDT</time>\n
<message id="70" from="[Alice](/human/alice)">\n\nTest message 70\n\n</message>\n
<time>May 17th at 10:00am EDT</time>\n
<message id="71" from="[Bob](/human/bob)">\n\nTest message 71\n\n</message>\n
<time>May 17th at 11:00am EDT</time>\n
<message id="72" from="[Alice](/human/alice)">\n\nTest message 72\n\n</message>\n
<time>May 17th at 12:00pm EDT</time>\n
<message id="73" from="[Bob](/human/bob)">\n\nTest message 73\n\n</message>\n
<time>May 17th at 1:00pm EDT</time>\n
<message id="74" from="[Alice](/human/alice)">\n\nTest message 74\n\n</message>\n
<time>May 17th at 2:00pm EDT</time>\n
<message id="75" from="[Bob](/human/bob)">\n\nTest message 75\n\n</message>\n
<time>May 17th at 3:00pm EDT</time>\n
<message id="76" from="[Alice](/human/alice)">\n\nTest message 76\n\n</message>\n
<time>May 17th at 4:00pm EDT</time>\n
<message id="77" from="[Bob](/human/bob)">\n\nTest message 77\n\n</message>\n
<time>May 17th at 5:00pm EDT</time>\n
<message id="78" from="[Alice](/human/alice)">\n\nTest message 78\n\n</message>\n
<time>May 17th at 6:00pm EDT</time>\n
<message id="79" from="[Bob](/human/bob)">\n\nTest message 79\n\n</message>\n
<time>May 17th at 7:00pm EDT</time>\n
<message id="80" from="[Alice](/human/alice)">\n\nTest message 80\n\n</message>\n
<time>May 17th at 8:00pm EDT</time>\n
<message id="81" from="[Bob](/human/bob)">\n\nTest message 81\n\n</message>\n
<time>May 17th at 9:00pm EDT</time>\n
<message id="82" from="[Alice](/human/alice)">\n\nTest message 82\n\n</message>\n
<time>May 17th at 10:00pm EDT</time>\n
<message id="83" from="[Bob](/human/bob)">\n\nTest message 83\n\n</message>\n
<time>May 17th at 11:00pm EDT</time>\n
<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<time>May 18th at 12:00am EDT</time>\n
<message id="85" from="[Bob](/human/bob)">\n\nTest message 85\n\n</message>\n
<time>May 18th at 1:00am EDT</time>\n
<message id="86" from="[Alice](/human/alice)">\n\nTest message 86\n\n</message>\n
<time>May 18th at 2:00am EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<time>May 18th at 3:00am EDT</time>\n
<message id="88" from="[Alice](/human/alice)">\n\nTest message 88\n\n</message>\n
<time>May 18th at 4:00am EDT</time>\n
<message id="89" from="[Bob](/human/bob)">\n\nTest message 89\n\n</message>

End of messages.`,
        },
    ])(
        "reads messages from end with one request when messages are more than an hour apart (limit: $limit)",
        async ({limit, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            mockApiGetChatMessages(api, {
                spaceId,
                chatId,
                from: "End",
                totalMessageCount: 90,
                limit: 30,
                createMessage: index =>
                    createApiMessageMock({
                        index,
                        author,
                        createdTime: new Date(Date.UTC(2026, 4, 14, 15, index * 60)).toISOString(),
                    }),
            });

            expect(
                await callAgentWebReadTool(context, {
                    path: "/chat/incident-response",
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            limit: "500b",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=2)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Test message 0

</message>

<time>May 14th at 12:00pm EDT</time>

<message id="1" from="[Bob](/human/bob)">

Test message 1

</message>

<time>May 14th at 1:00pm EDT</time>

<message id="2" from="[Alice](/human/alice)">

Test message 2

</message>`,
        },
        {
            limit: "750b",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=5)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<time>May 14th at 1:00pm EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>`,
        },
        {
            limit: "3.404kb",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=28)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<time>May 14th at 1:00pm EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>\n
<time>May 14th at 5:00pm EDT</time>\n
<message id="6" from="[Alice](/human/alice)">\n\nTest message 6\n\n</message>\n
<time>May 14th at 6:00pm EDT</time>\n
<message id="7" from="[Bob](/human/bob)">\n\nTest message 7\n\n</message>\n
<time>May 14th at 7:00pm EDT</time>\n
<message id="8" from="[Alice](/human/alice)">\n\nTest message 8\n\n</message>\n
<time>May 14th at 8:00pm EDT</time>\n
<message id="9" from="[Bob](/human/bob)">\n\nTest message 9\n\n</message>\n
<time>May 14th at 9:00pm EDT</time>\n
<message id="10" from="[Alice](/human/alice)">\n\nTest message 10\n\n</message>\n
<time>May 14th at 10:00pm EDT</time>\n
<message id="11" from="[Bob](/human/bob)">\n\nTest message 11\n\n</message>\n
<time>May 14th at 11:00pm EDT</time>\n
<message id="12" from="[Alice](/human/alice)">\n\nTest message 12\n\n</message>\n
<time>May 15th at 12:00am EDT</time>\n
<message id="13" from="[Bob](/human/bob)">\n\nTest message 13\n\n</message>\n
<time>May 15th at 1:00am EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<time>May 15th at 2:00am EDT</time>\n
<message id="15" from="[Bob](/human/bob)">\n\nTest message 15\n\n</message>\n
<time>May 15th at 3:00am EDT</time>\n
<message id="16" from="[Alice](/human/alice)">\n\nTest message 16\n\n</message>\n
<time>May 15th at 4:00am EDT</time>\n
<message id="17" from="[Bob](/human/bob)">\n\nTest message 17\n\n</message>\n
<time>May 15th at 5:00am EDT</time>\n
<message id="18" from="[Alice](/human/alice)">\n\nTest message 18\n\n</message>\n
<time>May 15th at 6:00am EDT</time>\n
<message id="19" from="[Bob](/human/bob)">\n\nTest message 19\n\n</message>\n
<time>May 15th at 7:00am EDT</time>\n
<message id="20" from="[Alice](/human/alice)">\n\nTest message 20\n\n</message>\n
<time>May 15th at 8:00am EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<time>May 15th at 9:00am EDT</time>\n
<message id="22" from="[Alice](/human/alice)">\n\nTest message 22\n\n</message>\n
<time>May 15th at 10:00am EDT</time>\n
<message id="23" from="[Bob](/human/bob)">\n\nTest message 23\n\n</message>\n
<time>May 15th at 11:00am EDT</time>\n
<message id="24" from="[Alice](/human/alice)">\n\nTest message 24\n\n</message>\n
<time>May 15th at 12:00pm EDT</time>\n
<message id="25" from="[Bob](/human/bob)">\n\nTest message 25\n\n</message>\n
<time>May 15th at 1:00pm EDT</time>\n
<message id="26" from="[Alice](/human/alice)">\n\nTest message 26\n\n</message>\n
<time>May 15th at 2:00pm EDT</time>\n
<message id="27" from="[Bob](/human/bob)">\n\nTest message 27\n\n</message>\n
<time>May 15th at 3:00pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>`,
        },
        {
            limit: "3.416kb",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=29)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<time>May 14th at 1:00pm EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>\n
<time>May 14th at 5:00pm EDT</time>\n
<message id="6" from="[Alice](/human/alice)">\n\nTest message 6\n\n</message>\n
<time>May 14th at 6:00pm EDT</time>\n
<message id="7" from="[Bob](/human/bob)">\n\nTest message 7\n\n</message>\n
<time>May 14th at 7:00pm EDT</time>\n
<message id="8" from="[Alice](/human/alice)">\n\nTest message 8\n\n</message>\n
<time>May 14th at 8:00pm EDT</time>\n
<message id="9" from="[Bob](/human/bob)">\n\nTest message 9\n\n</message>\n
<time>May 14th at 9:00pm EDT</time>\n
<message id="10" from="[Alice](/human/alice)">\n\nTest message 10\n\n</message>\n
<time>May 14th at 10:00pm EDT</time>\n
<message id="11" from="[Bob](/human/bob)">\n\nTest message 11\n\n</message>\n
<time>May 14th at 11:00pm EDT</time>\n
<message id="12" from="[Alice](/human/alice)">\n\nTest message 12\n\n</message>\n
<time>May 15th at 12:00am EDT</time>\n
<message id="13" from="[Bob](/human/bob)">\n\nTest message 13\n\n</message>\n
<time>May 15th at 1:00am EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<time>May 15th at 2:00am EDT</time>\n
<message id="15" from="[Bob](/human/bob)">\n\nTest message 15\n\n</message>\n
<time>May 15th at 3:00am EDT</time>\n
<message id="16" from="[Alice](/human/alice)">\n\nTest message 16\n\n</message>\n
<time>May 15th at 4:00am EDT</time>\n
<message id="17" from="[Bob](/human/bob)">\n\nTest message 17\n\n</message>\n
<time>May 15th at 5:00am EDT</time>\n
<message id="18" from="[Alice](/human/alice)">\n\nTest message 18\n\n</message>\n
<time>May 15th at 6:00am EDT</time>\n
<message id="19" from="[Bob](/human/bob)">\n\nTest message 19\n\n</message>\n
<time>May 15th at 7:00am EDT</time>\n
<message id="20" from="[Alice](/human/alice)">\n\nTest message 20\n\n</message>\n
<time>May 15th at 8:00am EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<time>May 15th at 9:00am EDT</time>\n
<message id="22" from="[Alice](/human/alice)">\n\nTest message 22\n\n</message>\n
<time>May 15th at 10:00am EDT</time>\n
<message id="23" from="[Bob](/human/bob)">\n\nTest message 23\n\n</message>\n
<time>May 15th at 11:00am EDT</time>\n
<message id="24" from="[Alice](/human/alice)">\n\nTest message 24\n\n</message>\n
<time>May 15th at 12:00pm EDT</time>\n
<message id="25" from="[Bob](/human/bob)">\n\nTest message 25\n\n</message>\n
<time>May 15th at 1:00pm EDT</time>\n
<message id="26" from="[Alice](/human/alice)">\n\nTest message 26\n\n</message>\n
<time>May 15th at 2:00pm EDT</time>\n
<message id="27" from="[Bob](/human/bob)">\n\nTest message 27\n\n</message>\n
<time>May 15th at 3:00pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>\n
<time>May 15th at 4:00pm EDT</time>\n
<message id="29" from="[Bob](/human/bob)">\n\nTest message 29\n\n</message>`,
        },
    ])(
        "reads messages from start with one request when messages are more than an hour apart (limit: $limit)",
        async ({limit, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            mockApiGetChatMessages(api, {
                spaceId,
                chatId,
                totalMessageCount: 90,
                limit: 30,
                createMessage: index =>
                    createApiMessageMock({
                        index,
                        author,
                        createdTime: new Date(Date.UTC(2026, 4, 14, 15, index * 60)).toISOString(),
                    }),
            });

            expect(
                await callAgentWebReadTool(context, {
                    path: "/chat/incident-response?start",
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            requestCount: 1,
            before: 60,
            cursors: [60],
            limit: "500b",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=57)

<time>May 16th at 8:00pm EDT</time>\n
<message id="57" from="[Bob](/human/bob)">\n\nTest message 57\n\n</message>\n
<time>May 16th at 9:00pm EDT</time>\n
<message id="58" from="[Alice](/human/alice)">\n\nTest message 58\n\n</message>\n
<time>May 16th at 10:00pm EDT</time>\n
<message id="59" from="[Bob](/human/bob)">\n\nTest message 59\n\n</message>`,
        },
        {
            requestCount: 1,
            before: 60,
            cursors: [60],
            limit: "750b",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=55)

<time>May 16th at 6:00pm EDT</time>\n
<message id="55" from="[Bob](/human/bob)">\n\nTest message 55\n\n</message>\n
<time>May 16th at 7:00pm EDT</time>\n
<message id="56" from="[Alice](/human/alice)">\n\nTest message 56\n\n</message>\n
<time>May 16th at 8:00pm EDT</time>\n
<message id="57" from="[Bob](/human/bob)">\n\nTest message 57\n\n</message>\n
<time>May 16th at 9:00pm EDT</time>\n
<message id="58" from="[Alice](/human/alice)">\n\nTest message 58\n\n</message>\n
<time>May 16th at 10:00pm EDT</time>\n
<message id="59" from="[Bob](/human/bob)">\n\nTest message 59\n\n</message>`,
        },
        {
            requestCount: 1,
            before: 60,
            cursors: [60],
            limit: "3.440kb",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=30)

<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<time>May 15th at 8:00pm EDT</time>\n
<message id="33" from="[Bob](/human/bob)">\n\nTest message 33\n\n</message>\n
<time>May 15th at 9:00pm EDT</time>\n
<message id="34" from="[Alice](/human/alice)">\n\nTest message 34\n\n</message>\n
<time>May 15th at 10:00pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<time>May 15th at 11:00pm EDT</time>\n
<message id="36" from="[Alice](/human/alice)">\n\nTest message 36\n\n</message>\n
<time>May 16th at 12:00am EDT</time>\n
<message id="37" from="[Bob](/human/bob)">\n\nTest message 37\n\n</message>\n
<time>May 16th at 1:00am EDT</time>\n
<message id="38" from="[Alice](/human/alice)">\n\nTest message 38\n\n</message>\n
<time>May 16th at 2:00am EDT</time>\n
<message id="39" from="[Bob](/human/bob)">\n\nTest message 39\n\n</message>\n
<time>May 16th at 3:00am EDT</time>\n
<message id="40" from="[Alice](/human/alice)">\n\nTest message 40\n\n</message>\n
<time>May 16th at 4:00am EDT</time>\n
<message id="41" from="[Bob](/human/bob)">\n\nTest message 41\n\n</message>\n
<time>May 16th at 5:00am EDT</time>\n
<message id="42" from="[Alice](/human/alice)">\n\nTest message 42\n\n</message>\n
<time>May 16th at 6:00am EDT</time>\n
<message id="43" from="[Bob](/human/bob)">\n\nTest message 43\n\n</message>\n
<time>May 16th at 7:00am EDT</time>\n
<message id="44" from="[Alice](/human/alice)">\n\nTest message 44\n\n</message>\n
<time>May 16th at 8:00am EDT</time>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<time>May 16th at 9:00am EDT</time>\n
<message id="46" from="[Alice](/human/alice)">\n\nTest message 46\n\n</message>\n
<time>May 16th at 10:00am EDT</time>\n
<message id="47" from="[Bob](/human/bob)">\n\nTest message 47\n\n</message>\n
<time>May 16th at 11:00am EDT</time>\n
<message id="48" from="[Alice](/human/alice)">\n\nTest message 48\n\n</message>\n
<time>May 16th at 12:00pm EDT</time>\n
<message id="49" from="[Bob](/human/bob)">\n\nTest message 49\n\n</message>\n
<time>May 16th at 1:00pm EDT</time>\n
<message id="50" from="[Alice](/human/alice)">\n\nTest message 50\n\n</message>\n
<time>May 16th at 2:00pm EDT</time>\n
<message id="51" from="[Bob](/human/bob)">\n\nTest message 51\n\n</message>\n
<time>May 16th at 3:00pm EDT</time>\n
<message id="52" from="[Alice](/human/alice)">\n\nTest message 52\n\n</message>\n
<time>May 16th at 4:00pm EDT</time>\n
<message id="53" from="[Bob](/human/bob)">\n\nTest message 53\n\n</message>\n
<time>May 16th at 5:00pm EDT</time>\n
<message id="54" from="[Alice](/human/alice)">\n\nTest message 54\n\n</message>\n
<time>May 16th at 6:00pm EDT</time>\n
<message id="55" from="[Bob](/human/bob)">\n\nTest message 55\n\n</message>\n
<time>May 16th at 7:00pm EDT</time>\n
<message id="56" from="[Alice](/human/alice)">\n\nTest message 56\n\n</message>\n
<time>May 16th at 8:00pm EDT</time>\n
<message id="57" from="[Bob](/human/bob)">\n\nTest message 57\n\n</message>\n
<time>May 16th at 9:00pm EDT</time>\n
<message id="58" from="[Alice](/human/alice)">\n\nTest message 58\n\n</message>\n
<time>May 16th at 10:00pm EDT</time>\n
<message id="59" from="[Bob](/human/bob)">\n\nTest message 59\n\n</message>`,
        },
        {
            requestCount: 2,
            before: 60,
            cursors: [60, 30],
            limit: "3.984kb",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=26)

<time>May 15th at 1:00pm EDT</time>\n
<message id="26" from="[Alice](/human/alice)">\n\nTest message 26\n\n</message>\n
<time>May 15th at 2:00pm EDT</time>\n
<message id="27" from="[Bob](/human/bob)">\n\nTest message 27\n\n</message>\n
<time>May 15th at 3:00pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>\n
<time>May 15th at 4:00pm EDT</time>\n
<message id="29" from="[Bob](/human/bob)">\n\nTest message 29\n\n</message>\n
<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<time>May 15th at 8:00pm EDT</time>\n
<message id="33" from="[Bob](/human/bob)">\n\nTest message 33\n\n</message>\n
<time>May 15th at 9:00pm EDT</time>\n
<message id="34" from="[Alice](/human/alice)">\n\nTest message 34\n\n</message>\n
<time>May 15th at 10:00pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<time>May 15th at 11:00pm EDT</time>\n
<message id="36" from="[Alice](/human/alice)">\n\nTest message 36\n\n</message>\n
<time>May 16th at 12:00am EDT</time>\n
<message id="37" from="[Bob](/human/bob)">\n\nTest message 37\n\n</message>\n
<time>May 16th at 1:00am EDT</time>\n
<message id="38" from="[Alice](/human/alice)">\n\nTest message 38\n\n</message>\n
<time>May 16th at 2:00am EDT</time>\n
<message id="39" from="[Bob](/human/bob)">\n\nTest message 39\n\n</message>\n
<time>May 16th at 3:00am EDT</time>\n
<message id="40" from="[Alice](/human/alice)">\n\nTest message 40\n\n</message>\n
<time>May 16th at 4:00am EDT</time>\n
<message id="41" from="[Bob](/human/bob)">\n\nTest message 41\n\n</message>\n
<time>May 16th at 5:00am EDT</time>\n
<message id="42" from="[Alice](/human/alice)">\n\nTest message 42\n\n</message>\n
<time>May 16th at 6:00am EDT</time>\n
<message id="43" from="[Bob](/human/bob)">\n\nTest message 43\n\n</message>\n
<time>May 16th at 7:00am EDT</time>\n
<message id="44" from="[Alice](/human/alice)">\n\nTest message 44\n\n</message>\n
<time>May 16th at 8:00am EDT</time>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<time>May 16th at 9:00am EDT</time>\n
<message id="46" from="[Alice](/human/alice)">\n\nTest message 46\n\n</message>\n
<time>May 16th at 10:00am EDT</time>\n
<message id="47" from="[Bob](/human/bob)">\n\nTest message 47\n\n</message>\n
<time>May 16th at 11:00am EDT</time>\n
<message id="48" from="[Alice](/human/alice)">\n\nTest message 48\n\n</message>\n
<time>May 16th at 12:00pm EDT</time>\n
<message id="49" from="[Bob](/human/bob)">\n\nTest message 49\n\n</message>\n
<time>May 16th at 1:00pm EDT</time>\n
<message id="50" from="[Alice](/human/alice)">\n\nTest message 50\n\n</message>\n
<time>May 16th at 2:00pm EDT</time>\n
<message id="51" from="[Bob](/human/bob)">\n\nTest message 51\n\n</message>\n
<time>May 16th at 3:00pm EDT</time>\n
<message id="52" from="[Alice](/human/alice)">\n\nTest message 52\n\n</message>\n
<time>May 16th at 4:00pm EDT</time>\n
<message id="53" from="[Bob](/human/bob)">\n\nTest message 53\n\n</message>\n
<time>May 16th at 5:00pm EDT</time>\n
<message id="54" from="[Alice](/human/alice)">\n\nTest message 54\n\n</message>\n
<time>May 16th at 6:00pm EDT</time>\n
<message id="55" from="[Bob](/human/bob)">\n\nTest message 55\n\n</message>\n
<time>May 16th at 7:00pm EDT</time>\n
<message id="56" from="[Alice](/human/alice)">\n\nTest message 56\n\n</message>\n
<time>May 16th at 8:00pm EDT</time>\n
<message id="57" from="[Bob](/human/bob)">\n\nTest message 57\n\n</message>\n
<time>May 16th at 9:00pm EDT</time>\n
<message id="58" from="[Alice](/human/alice)">\n\nTest message 58\n\n</message>\n
<time>May 16th at 10:00pm EDT</time>\n
<message id="59" from="[Bob](/human/bob)">\n\nTest message 59\n\n</message>`,
        },
    ])(
        "reads messages before a cursor with pagination when messages are more than an hour apart (requests: $requestCount, limit: $limit)",
        async ({before, cursors, limit, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const cursor of cursors) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    from: "End",
                    totalMessageCount: 90,
                    limit: 30,
                    cursor,
                    createMessage: index =>
                        createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(
                                Date.UTC(2026, 4, 14, 15, index * 60),
                            ).toISOString(),
                        }),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path: "/chat/incident-response?before=" + before,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            requestCount: 1,
            after: 29,
            cursors: [29],
            limit: "500b",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=32)

<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>`,
        },
        {
            requestCount: 1,
            after: 29,
            cursors: [29],
            limit: "734b",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=34)

<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<time>May 15th at 8:00pm EDT</time>\n
<message id="33" from="[Bob](/human/bob)">\n\nTest message 33\n\n</message>\n
<time>May 15th at 9:00pm EDT</time>\n
<message id="34" from="[Alice](/human/alice)">\n\nTest message 34\n\n</message>`,
        },
        {
            requestCount: 1,
            after: 29,
            cursors: [29],
            limit: "3.435kb",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=59)

<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<time>May 15th at 8:00pm EDT</time>\n
<message id="33" from="[Bob](/human/bob)">\n\nTest message 33\n\n</message>\n
<time>May 15th at 9:00pm EDT</time>\n
<message id="34" from="[Alice](/human/alice)">\n\nTest message 34\n\n</message>\n
<time>May 15th at 10:00pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<time>May 15th at 11:00pm EDT</time>\n
<message id="36" from="[Alice](/human/alice)">\n\nTest message 36\n\n</message>\n
<time>May 16th at 12:00am EDT</time>\n
<message id="37" from="[Bob](/human/bob)">\n\nTest message 37\n\n</message>\n
<time>May 16th at 1:00am EDT</time>\n
<message id="38" from="[Alice](/human/alice)">\n\nTest message 38\n\n</message>\n
<time>May 16th at 2:00am EDT</time>\n
<message id="39" from="[Bob](/human/bob)">\n\nTest message 39\n\n</message>\n
<time>May 16th at 3:00am EDT</time>\n
<message id="40" from="[Alice](/human/alice)">\n\nTest message 40\n\n</message>\n
<time>May 16th at 4:00am EDT</time>\n
<message id="41" from="[Bob](/human/bob)">\n\nTest message 41\n\n</message>\n
<time>May 16th at 5:00am EDT</time>\n
<message id="42" from="[Alice](/human/alice)">\n\nTest message 42\n\n</message>\n
<time>May 16th at 6:00am EDT</time>\n
<message id="43" from="[Bob](/human/bob)">\n\nTest message 43\n\n</message>\n
<time>May 16th at 7:00am EDT</time>\n
<message id="44" from="[Alice](/human/alice)">\n\nTest message 44\n\n</message>\n
<time>May 16th at 8:00am EDT</time>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<time>May 16th at 9:00am EDT</time>\n
<message id="46" from="[Alice](/human/alice)">\n\nTest message 46\n\n</message>\n
<time>May 16th at 10:00am EDT</time>\n
<message id="47" from="[Bob](/human/bob)">\n\nTest message 47\n\n</message>\n
<time>May 16th at 11:00am EDT</time>\n
<message id="48" from="[Alice](/human/alice)">\n\nTest message 48\n\n</message>\n
<time>May 16th at 12:00pm EDT</time>\n
<message id="49" from="[Bob](/human/bob)">\n\nTest message 49\n\n</message>\n
<time>May 16th at 1:00pm EDT</time>\n
<message id="50" from="[Alice](/human/alice)">\n\nTest message 50\n\n</message>\n
<time>May 16th at 2:00pm EDT</time>\n
<message id="51" from="[Bob](/human/bob)">\n\nTest message 51\n\n</message>\n
<time>May 16th at 3:00pm EDT</time>\n
<message id="52" from="[Alice](/human/alice)">\n\nTest message 52\n\n</message>\n
<time>May 16th at 4:00pm EDT</time>\n
<message id="53" from="[Bob](/human/bob)">\n\nTest message 53\n\n</message>\n
<time>May 16th at 5:00pm EDT</time>\n
<message id="54" from="[Alice](/human/alice)">\n\nTest message 54\n\n</message>\n
<time>May 16th at 6:00pm EDT</time>\n
<message id="55" from="[Bob](/human/bob)">\n\nTest message 55\n\n</message>\n
<time>May 16th at 7:00pm EDT</time>\n
<message id="56" from="[Alice](/human/alice)">\n\nTest message 56\n\n</message>\n
<time>May 16th at 8:00pm EDT</time>\n
<message id="57" from="[Bob](/human/bob)">\n\nTest message 57\n\n</message>\n
<time>May 16th at 9:00pm EDT</time>\n
<message id="58" from="[Alice](/human/alice)">\n\nTest message 58\n\n</message>\n
<time>May 16th at 10:00pm EDT</time>\n
<message id="59" from="[Bob](/human/bob)">\n\nTest message 59\n\n</message>`,
        },
        {
            requestCount: 2,
            after: 29,
            cursors: [29, 59],
            limit: "4.984kb",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=72)

<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<time>May 15th at 8:00pm EDT</time>\n
<message id="33" from="[Bob](/human/bob)">\n\nTest message 33\n\n</message>\n
<time>May 15th at 9:00pm EDT</time>\n
<message id="34" from="[Alice](/human/alice)">\n\nTest message 34\n\n</message>\n
<time>May 15th at 10:00pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<time>May 15th at 11:00pm EDT</time>\n
<message id="36" from="[Alice](/human/alice)">\n\nTest message 36\n\n</message>\n
<time>May 16th at 12:00am EDT</time>\n
<message id="37" from="[Bob](/human/bob)">\n\nTest message 37\n\n</message>\n
<time>May 16th at 1:00am EDT</time>\n
<message id="38" from="[Alice](/human/alice)">\n\nTest message 38\n\n</message>\n
<time>May 16th at 2:00am EDT</time>\n
<message id="39" from="[Bob](/human/bob)">\n\nTest message 39\n\n</message>\n
<time>May 16th at 3:00am EDT</time>\n
<message id="40" from="[Alice](/human/alice)">\n\nTest message 40\n\n</message>\n
<time>May 16th at 4:00am EDT</time>\n
<message id="41" from="[Bob](/human/bob)">\n\nTest message 41\n\n</message>\n
<time>May 16th at 5:00am EDT</time>\n
<message id="42" from="[Alice](/human/alice)">\n\nTest message 42\n\n</message>\n
<time>May 16th at 6:00am EDT</time>\n
<message id="43" from="[Bob](/human/bob)">\n\nTest message 43\n\n</message>\n
<time>May 16th at 7:00am EDT</time>\n
<message id="44" from="[Alice](/human/alice)">\n\nTest message 44\n\n</message>\n
<time>May 16th at 8:00am EDT</time>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<time>May 16th at 9:00am EDT</time>\n
<message id="46" from="[Alice](/human/alice)">\n\nTest message 46\n\n</message>\n
<time>May 16th at 10:00am EDT</time>\n
<message id="47" from="[Bob](/human/bob)">\n\nTest message 47\n\n</message>\n
<time>May 16th at 11:00am EDT</time>\n
<message id="48" from="[Alice](/human/alice)">\n\nTest message 48\n\n</message>\n
<time>May 16th at 12:00pm EDT</time>\n
<message id="49" from="[Bob](/human/bob)">\n\nTest message 49\n\n</message>\n
<time>May 16th at 1:00pm EDT</time>\n
<message id="50" from="[Alice](/human/alice)">\n\nTest message 50\n\n</message>\n
<time>May 16th at 2:00pm EDT</time>\n
<message id="51" from="[Bob](/human/bob)">\n\nTest message 51\n\n</message>\n
<time>May 16th at 3:00pm EDT</time>\n
<message id="52" from="[Alice](/human/alice)">\n\nTest message 52\n\n</message>\n
<time>May 16th at 4:00pm EDT</time>\n
<message id="53" from="[Bob](/human/bob)">\n\nTest message 53\n\n</message>\n
<time>May 16th at 5:00pm EDT</time>\n
<message id="54" from="[Alice](/human/alice)">\n\nTest message 54\n\n</message>\n
<time>May 16th at 6:00pm EDT</time>\n
<message id="55" from="[Bob](/human/bob)">\n\nTest message 55\n\n</message>\n
<time>May 16th at 7:00pm EDT</time>\n
<message id="56" from="[Alice](/human/alice)">\n\nTest message 56\n\n</message>\n
<time>May 16th at 8:00pm EDT</time>\n
<message id="57" from="[Bob](/human/bob)">\n\nTest message 57\n\n</message>\n
<time>May 16th at 9:00pm EDT</time>\n
<message id="58" from="[Alice](/human/alice)">\n\nTest message 58\n\n</message>\n
<time>May 16th at 10:00pm EDT</time>\n
<message id="59" from="[Bob](/human/bob)">\n\nTest message 59\n\n</message>\n
<time>May 16th at 11:00pm EDT</time>\n
<message id="60" from="[Alice](/human/alice)">\n\nTest message 60\n\n</message>\n
<time>May 17th at 12:00am EDT</time>\n
<message id="61" from="[Bob](/human/bob)">\n\nTest message 61\n\n</message>\n
<time>May 17th at 1:00am EDT</time>\n
<message id="62" from="[Alice](/human/alice)">\n\nTest message 62\n\n</message>\n
<time>May 17th at 2:00am EDT</time>\n
<message id="63" from="[Bob](/human/bob)">\n\nTest message 63\n\n</message>\n
<time>May 17th at 3:00am EDT</time>\n
<message id="64" from="[Alice](/human/alice)">\n\nTest message 64\n\n</message>\n
<time>May 17th at 4:00am EDT</time>\n
<message id="65" from="[Bob](/human/bob)">\n\nTest message 65\n\n</message>\n
<time>May 17th at 5:00am EDT</time>\n
<message id="66" from="[Alice](/human/alice)">\n\nTest message 66\n\n</message>\n
<time>May 17th at 6:00am EDT</time>\n
<message id="67" from="[Bob](/human/bob)">\n\nTest message 67\n\n</message>\n
<time>May 17th at 7:00am EDT</time>\n
<message id="68" from="[Alice](/human/alice)">\n\nTest message 68\n\n</message>\n
<time>May 17th at 8:00am EDT</time>\n
<message id="69" from="[Bob](/human/bob)">\n\nTest message 69\n\n</message>\n
<time>May 17th at 9:00am EDT</time>\n
<message id="70" from="[Alice](/human/alice)">\n\nTest message 70\n\n</message>\n
<time>May 17th at 10:00am EDT</time>\n
<message id="71" from="[Bob](/human/bob)">\n\nTest message 71\n\n</message>\n
<time>May 17th at 11:00am EDT</time>\n
<message id="72" from="[Alice](/human/alice)">\n\nTest message 72\n\n</message>`,
        },
    ])(
        "reads messages after a cursor with pagination when messages are more than an hour apart (requests: $requestCount, limit: $limit)",
        async ({after, cursors, limit, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const cursor of cursors) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    limit: 30,
                    cursor,
                    createMessage: index =>
                        createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(
                                Date.UTC(2026, 4, 14, 15, index * 60),
                            ).toISOString(),
                        }),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path: "/chat/incident-response?after=" + after,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?start",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=28)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>`,
        },
        {
            path: "/chat/incident-response?after=28",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=57)

<time>May 14th at 1:25pm EDT</time>\n
<message id="29" from="[Bob](/human/bob)">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>`,
        },
        {
            path: "/chat/incident-response?after=57",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=86)

<time>May 14th at 3:50pm EDT</time>\n
<message id="58" from="[Alice](/human/alice)">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>`,
        },
        {
            path: "/chat/incident-response?after=86",
            response: `\
# Incident Response

<time>May 14th at 6:15pm EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
    ])("paginates from start to end with 3kb pages ($path)", async ({path, response}) => {
        mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

        const cursorParam = new URL(`https://agent.test${path}`).searchParams.get("after");

        mockApiGetChatMessages(api, {
            spaceId,
            chatId,
            totalMessageCount: 90,
            limit: 30,
            ...(cursorParam !== null ? {cursor: parseInt(cursorParam, 10)} : {}),
            createMessage: index => createApiMessageMock({index, author}),
        });

        expect(
            await callAgentWebReadTool(context, {
                path,
                limit: "3kb",
            }),
        ).toEqual(response);
    });

    test.each([
        {
            path: "/chat/incident-response?end",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=61)

<time>May 14th at 4:05pm EDT</time>\n
<message id="61" from="[Bob](/human/bob)">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?before=61",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=32)

<time>May 14th at 1:40pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>`,
        },
        {
            path: "/chat/incident-response?before=32",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=3)

<time>May 14th at 11:15am EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>`,
        },
        {
            path: "/chat/incident-response?before=3",
            response: `\
# Incident Response

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>`,
        },
    ])("paginates from end to start with 3kb pages ($path)", async ({path, response}) => {
        mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

        const cursorParam = new URL(`https://agent.test${path}`).searchParams.get("before");

        mockApiGetChatMessages(api, {
            spaceId,
            chatId,
            from: "End",
            totalMessageCount: 90,
            limit: 30,
            ...(cursorParam !== null ? {cursor: parseInt(cursorParam, 10)} : {}),
            createMessage: index => createApiMessageMock({index, author}),
        });

        expect(
            await callAgentWebReadTool(context, {
                path,
                limit: "3kb",
            }),
        ).toEqual(response);
    });

    test.each([
        {
            path: "/chat/incident-response?message=45",
            limit: "500b",
            requests: [{limit: 30, cursor: 30}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=44) | [Next page »](/chat/incident-response?after=46)

<time>May 14th at 2:40pm EDT</time>\n
<message id="44" from="[Alice](/human/alice)">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=45",
            limit: "1kb",
            requests: [{limit: 30, cursor: 30}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=42) | [Next page »](/chat/incident-response?after=49)

<time>May 14th at 2:30pm EDT</time>\n
<message id="42" from="[Alice](/human/alice)">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=45",
            limit: "3.075kb",
            requests: [{limit: 30, cursor: 30}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=31) | [Next page »](/chat/incident-response?after=59)

<time>May 14th at 1:35pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=45",
            limit: "3.077kb",
            requests: [{limit: 30, cursor: 30}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=31) | [Next page »](/chat/incident-response?after=60)

<time>May 14th at 1:35pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=45",
            limit: "5kb",
            requests: [
                {limit: 30, cursor: 30},
                {from: "End" as const, limit: 15, cursor: 31},
                {limit: 15, cursor: 60},
            ],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=21) | [Next page »](/chat/incident-response?after=69)

<time>May 14th at 12:45pm EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>`,
        },
    ])(
        "reads single message in the middle of a long message list (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=4",
            limit: "500b",
            requests: [{limit: 30, cursor: -11}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=3) | [Next page »](/chat/incident-response?after=5)

<time>May 14th at 11:15am EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=4",
            limit: "600b",
            requests: [{limit: 30, cursor: -11}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=3) | [Next page »](/chat/incident-response?after=6)

<time>May 14th at 11:15am EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=4",
            limit: "1kb",
            requests: [{limit: 30, cursor: -11}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=1) | [Next page »](/chat/incident-response?after=8)

<time>May 14th at 11:05am EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=4",
            limit: "2.02kb",
            requests: [{limit: 30, cursor: -11}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=17)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=4",
            limit: "2.022kb",
            requests: [{limit: 30, cursor: -11}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=17)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=4",
            limit: "4kb",
            requests: [
                {limit: 30, cursor: -11},
                {limit: 15, cursor: 29},
            ],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=38)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>`,
        },
    ])(
        "reads single message near the top of a long message list (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=0",
            limit: "500b",
            requests: [{limit: 30, cursor: -15}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=2)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=0",
            limit: "1kb",
            requests: [{limit: 30, cursor: -15}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=7)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=0",
            limit: "1.629kb",
            requests: [{limit: 30, cursor: -15}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=13)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=0",
            limit: "1.630kb",
            requests: [{limit: 30, cursor: -15}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=13)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=0",
            limit: "3kb",
            requests: [{limit: 30, cursor: -15}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=27)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>`,
        },
    ])(
        "reads single message at the top of a long message list (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=85",
            limit: "500b",
            requests: [{limit: 30, cursor: 70}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=84) | [Next page »](/chat/incident-response?after=86)

<time>May 14th at 6:00pm EDT</time>\n
<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=85",
            limit: "1kb",
            requests: [{limit: 30, cursor: 70}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=82)

<time>May 14th at 5:50pm EDT</time>\n
<message id="82" from="[Alice](/human/alice)">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=85",
            limit: "1.963kb",
            requests: [{limit: 30, cursor: 70}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=72)

<time>May 14th at 5:00pm EDT</time>\n
<message id="72" from="[Alice](/human/alice)">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=85",
            limit: "1.965kb",
            requests: [{limit: 30, cursor: 70}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=71)

<time>May 14th at 4:55pm EDT</time>\n
<message id="71" from="[Bob](/human/bob)">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=85",
            limit: "3kb",
            requests: [
                {limit: 30, cursor: 70},
                {from: "End" as const, limit: 15, cursor: 71},
            ],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=62)

<time>May 14th at 4:10pm EDT</time>\n
<message id="62" from="[Alice](/human/alice)">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
    ])(
        "reads single message near the end of a long message list (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=89",
            limit: "500b",
            requests: [{limit: 30, cursor: 74}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=87)

<time>May 14th at 6:15pm EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=89",
            limit: "1kb",
            requests: [{limit: 30, cursor: 74}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=82)

<time>May 14th at 5:50pm EDT</time>\n
<message id="82" from="[Alice](/human/alice)">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=89",
            limit: "1.571kb",
            requests: [{limit: 30, cursor: 74}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=76)

<time>May 14th at 5:20pm EDT</time>\n
<message id="76" from="[Alice](/human/alice)">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=89",
            limit: "1.573kb",
            requests: [{limit: 30, cursor: 74}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=75)

<time>May 14th at 5:15pm EDT</time>\n
<message id="75" from="[Bob](/human/bob)">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=89",
            limit: "3kb",
            requests: [
                {limit: 30, cursor: 74},
                {from: "End" as const, limit: 15, cursor: 75},
            ],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=62)

<time>May 14th at 4:10pm EDT</time>\n
<message id="62" from="[Alice](/human/alice)">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
    ])(
        "reads single message at the end of a long message list (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            limit: "500b",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=5)

End of messages.`,
        },
        {
            limit: "1kb",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=5)

End of messages.`,
        },
    ])(
        "reads end of small message list when requested message is past total count (limit: $limit)",
        async ({limit, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            mockApiGetChatMessages(api, {
                spaceId,
                chatId,
                totalMessageCount: 5,
                limit: 30,
                cursor: 85,
                createMessage: index => createApiMessageMock({index, author}),
            });

            expect(
                await callAgentWebReadTool(context, {
                    path: "/chat/incident-response?message=100",
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            limit: "500b",
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=2)

<time>May 14th at 11:10am EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>

End of messages.`,
        },
        {
            limit: "1kb",
            response: `\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Test message 0

</message>

<message id="1" from="[Bob](/human/bob)" time="5 minutes later">

Test message 1

</message>

<message id="2" from="[Alice](/human/alice)" time="5 minutes later">

Test message 2

</message>

<message id="3" from="[Bob](/human/bob)" time="5 minutes later">

Test message 3

</message>

<message id="4" from="[Alice](/human/alice)" time="5 minutes later">

Test message 4

</message>

End of messages.`,
        },
    ])(
        "reads end of small message list when before cursor is past total count (limit: $limit)",
        async ({limit, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            mockApiGetChatMessages(api, {
                spaceId,
                chatId,
                from: "End",
                totalMessageCount: 5,
                limit: 30,
                cursor: 100,
                createMessage: index => createApiMessageMock({index, author}),
            });

            expect(
                await callAgentWebReadTool(context, {
                    path: "/chat/incident-response?before=100",
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            limit: "500b",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=2)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Test message 0

</message>

<message id="1" from="[Bob](/human/bob)" time="5 minutes later">

Test message 1

</message>

<message id="2" from="[Alice](/human/alice)" time="5 minutes later">

Test message 2

</message>`,
        },
        {
            limit: "1kb",
            response: `\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Test message 0

</message>

<message id="1" from="[Bob](/human/bob)" time="5 minutes later">

Test message 1

</message>

<message id="2" from="[Alice](/human/alice)" time="5 minutes later">

Test message 2

</message>

<message id="3" from="[Bob](/human/bob)" time="5 minutes later">

Test message 3

</message>

<message id="4" from="[Alice](/human/alice)" time="5 minutes later">

Test message 4

</message>

End of messages.`,
        },
    ])(
        "returns an error for a requested message before the start of the list (limit: $limit)",
        async ({limit}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            mockApiGetChatMessages(api, {
                spaceId,
                chatId,
                totalMessageCount: 5,
                limit: 30,
                cursor: -115,
                createMessage: index => createApiMessageMock({index, author}),
            });

            await expect(
                callAgentWebReadTool(context, {
                    path: "/chat/incident-response?message=-100",
                    limit,
                }),
            ).resolves.toBe(
                "Error: Couldn\u2019t read `/chat/incident-response?message=-100`. Couldn\u2019t find any messages in the requested range `-100`. Try again with a `<message>` `id` attribute you\u2019ve seen before.",
            );
        },
    );

    test.each([
        {
            limit: "500b",
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=3)

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Test message 0

</message>

<message id="1" from="[Bob](/human/bob)" time="5 minutes later">

Test message 1

</message>

<message id="2" from="[Alice](/human/alice)" time="5 minutes later">

Test message 2

</message>

<message id="3" from="[Bob](/human/bob)" time="5 minutes later">

Test message 3

</message>`,
        },
        {
            limit: "1kb",
            response: `\
# Incident Response

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Test message 0

</message>

<message id="1" from="[Bob](/human/bob)" time="5 minutes later">

Test message 1

</message>

<message id="2" from="[Alice](/human/alice)" time="5 minutes later">

Test message 2

</message>

<message id="3" from="[Bob](/human/bob)" time="5 minutes later">

Test message 3

</message>

<message id="4" from="[Alice](/human/alice)" time="5 minutes later">

Test message 4

</message>

End of messages.`,
        },
    ])(
        "reads start of small message list when after cursor is before total count (limit: $limit)",
        async ({limit, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            mockApiGetChatMessages(api, {
                spaceId,
                chatId,
                totalMessageCount: 5,
                limit: 30,
                cursor: -100,
                createMessage: index => createApiMessageMock({index, author}),
            });

            expect(
                await callAgentWebReadTool(context, {
                    path: "/chat/incident-response?after=-100",
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=44-45",
            limit: "500b",
            requests: [{limit: 30, cursor: 29}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=44) | [Next page »](/chat/incident-response?after=46)

<time>May 14th at 2:40pm EDT</time>\n
<message id="44" from="[Alice](/human/alice)">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=44-45",
            limit: "1kb",
            requests: [{limit: 30, cursor: 29}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=41) | [Next page »](/chat/incident-response?after=48)

<time>May 14th at 2:25pm EDT</time>\n
<message id="41" from="[Bob](/human/bob)">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=44-45",
            limit: "3.075kb",
            requests: [{limit: 30, cursor: 29}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=31) | [Next page »](/chat/incident-response?after=59)

<time>May 14th at 1:35pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=44-45",
            limit: "3.077kb",
            requests: [{limit: 30, cursor: 29}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=30) | [Next page »](/chat/incident-response?after=59)

<time>May 14th at 1:30pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=44-45",
            limit: "5kb",
            requests: [
                {limit: 30, cursor: 29},
                {from: "End" as const, limit: 15, cursor: 30},
                {limit: 15, cursor: 59},
            ],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=21) | [Next page »](/chat/incident-response?after=69)

<time>May 14th at 12:45pm EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 41\n\n</message>\n
<message id="42" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 42\n\n</message>\n
<message id="43" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 43\n\n</message>\n
<message id="44" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 48\n\n</message>\n
<message id="49" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 49\n\n</message>\n
<message id="50" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 50\n\n</message>\n
<message id="51" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 51\n\n</message>\n
<message id="52" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>`,
        },
    ])(
        "reads message range in the middle of a long message list (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=4-5",
            limit: "500b",
            requests: [{limit: 30, cursor: -11}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=4) | [Next page »](/chat/incident-response?after=6)

<time>May 14th at 11:20am EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=4-5",
            limit: "1kb",
            requests: [{limit: 30, cursor: -11}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=1) | [Next page »](/chat/incident-response?after=8)

<time>May 14th at 11:05am EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=4-5",
            limit: "2.021kb",
            requests: [{limit: 30, cursor: -11}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=17)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=4-5",
            limit: "2.022kb",
            requests: [{limit: 30, cursor: -11}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=17)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=4-5",
            limit: "4kb",
            requests: [
                {limit: 30, cursor: -11},
                {limit: 15, cursor: 29},
            ],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=38)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>\n
<message id="28" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 28\n\n</message>\n
<message id="29" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 29\n\n</message>\n
<message id="30" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 30\n\n</message>\n
<message id="31" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 34\n\n</message>\n
<message id="35" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 35\n\n</message>\n
<message id="36" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 36\n\n</message>\n
<message id="37" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 37\n\n</message>\n
<message id="38" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 38\n\n</message>`,
        },
    ])(
        "reads message range near the top of a long message list (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=0-1",
            limit: "500b",
            requests: [{limit: 30, cursor: -15}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=2)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=0-1",
            limit: "1kb",
            requests: [{limit: 30, cursor: -15}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=7)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=0-1",
            limit: "1.629kb",
            requests: [{limit: 30, cursor: -15}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=13)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=0-1",
            limit: "1.630kb",
            requests: [{limit: 30, cursor: -15}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=13)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=0-1",
            limit: "3kb",
            requests: [{limit: 30, cursor: -15}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=27)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<message id="1" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 1\n\n</message>\n
<message id="2" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 6\n\n</message>\n
<message id="7" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 8\n\n</message>\n
<message id="9" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 9\n\n</message>\n
<message id="10" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 10\n\n</message>\n
<message id="11" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 13\n\n</message>\n
<message id="14" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 15\n\n</message>\n
<message id="16" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 16\n\n</message>\n
<message id="17" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 20\n\n</message>\n
<message id="21" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 21\n\n</message>\n
<message id="22" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 22\n\n</message>\n
<message id="23" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 23\n\n</message>\n
<message id="24" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 27\n\n</message>`,
        },
    ])(
        "reads message range at the top of a long message list (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=84-85",
            limit: "500b",
            requests: [{limit: 30, cursor: 69}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=84) | [Next page »](/chat/incident-response?after=86)

<time>May 14th at 6:00pm EDT</time>\n
<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=84-85",
            limit: "1kb",
            requests: [{limit: 30, cursor: 69}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=81) | [Next page »](/chat/incident-response?after=88)

<time>May 14th at 5:45pm EDT</time>\n
<message id="81" from="[Bob](/human/bob)">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=84-85",
            limit: "2.063kb",
            requests: [{limit: 30, cursor: 69}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=71)

<time>May 14th at 4:55pm EDT</time>\n
<message id="71" from="[Bob](/human/bob)">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=84-85",
            limit: "2.065kb",
            requests: [{limit: 30, cursor: 69}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=70)

<time>May 14th at 4:50pm EDT</time>\n
<message id="70" from="[Alice](/human/alice)">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=84-85",
            limit: "4kb",
            requests: [
                {limit: 30, cursor: 69},
                {from: "End" as const, limit: 15, cursor: 70},
                {from: "End" as const, limit: 15, cursor: 55},
            ],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=52)

<time>May 14th at 3:20pm EDT</time>\n
<message id="52" from="[Alice](/human/alice)">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 55\n\n</message>\n
<message id="56" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 56\n\n</message>\n
<message id="57" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 57\n\n</message>\n
<message id="58" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 58\n\n</message>\n
<message id="59" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
    ])(
        "reads message range near the end of a long message list (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=88-89",
            limit: "500b",
            requests: [{limit: 30, cursor: 73}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=87)

<time>May 14th at 6:15pm EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=88-89",
            limit: "1kb",
            requests: [{limit: 30, cursor: 73}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=82)

<time>May 14th at 5:50pm EDT</time>\n
<message id="82" from="[Alice](/human/alice)">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=88-89",
            limit: "1.671kb",
            requests: [{limit: 30, cursor: 73}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=75)

<time>May 14th at 5:15pm EDT</time>\n
<message id="75" from="[Bob](/human/bob)">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=88-89",
            limit: "1.673kb",
            requests: [{limit: 30, cursor: 73}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=74)

<time>May 14th at 5:10pm EDT</time>\n
<message id="74" from="[Alice](/human/alice)">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=88-89",
            limit: "3kb",
            requests: [
                {limit: 30, cursor: 73},
                {from: "End" as const, limit: 15, cursor: 74},
            ],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=62)

<time>May 14th at 4:10pm EDT</time>\n
<message id="62" from="[Alice](/human/alice)">\n\nTest message 62\n\n</message>\n
<message id="63" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 63\n\n</message>\n
<message id="64" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 64\n\n</message>\n
<message id="65" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 65\n\n</message>\n
<message id="66" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 69\n\n</message>\n
<message id="70" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 70\n\n</message>\n
<message id="71" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 71\n\n</message>\n
<message id="72" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 72\n\n</message>\n
<message id="73" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 76\n\n</message>\n
<message id="77" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 78\n\n</message>\n
<message id="79" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 79\n\n</message>\n
<message id="80" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 80\n\n</message>\n
<message id="81" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 83\n\n</message>\n
<message id="84" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 84\n\n</message>\n
<message id="85" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 85\n\n</message>\n
<message id="86" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 86\n\n</message>\n
<message id="87" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 87\n\n</message>\n
<message id="88" from="[Alice](/human/alice)" time="5 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Bob](/human/bob)" time="5 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
    ])(
        "reads message range at the end of a long message list (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=45",
            limit: "500b",
            requests: [{limit: 30, cursor: 30}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=44) | [Next page »](/chat/incident-response?after=46)

<time>May 16th at 7:00am EDT</time>\n
<message id="44" from="[Alice](/human/alice)">\n\nTest message 44\n\n</message>\n
<time>May 16th at 8:00am EDT</time>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<time>May 16th at 9:00am EDT</time>\n
<message id="46" from="[Alice](/human/alice)">\n\nTest message 46\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=45",
            limit: "1kb",
            requests: [{limit: 30, cursor: 30}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=42) | [Next page »](/chat/incident-response?after=48)

<time>May 16th at 5:00am EDT</time>\n
<message id="42" from="[Alice](/human/alice)">\n\nTest message 42\n\n</message>\n
<time>May 16th at 6:00am EDT</time>\n
<message id="43" from="[Bob](/human/bob)">\n\nTest message 43\n\n</message>\n
<time>May 16th at 7:00am EDT</time>\n
<message id="44" from="[Alice](/human/alice)">\n\nTest message 44\n\n</message>\n
<time>May 16th at 8:00am EDT</time>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<time>May 16th at 9:00am EDT</time>\n
<message id="46" from="[Alice](/human/alice)">\n\nTest message 46\n\n</message>\n
<time>May 16th at 10:00am EDT</time>\n
<message id="47" from="[Bob](/human/bob)">\n\nTest message 47\n\n</message>\n
<time>May 16th at 11:00am EDT</time>\n
<message id="48" from="[Alice](/human/alice)">\n\nTest message 48\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=45",
            limit: "3.489kb",
            requests: [{limit: 30, cursor: 30}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=31) | [Next page »](/chat/incident-response?after=59)

<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<time>May 15th at 8:00pm EDT</time>\n
<message id="33" from="[Bob](/human/bob)">\n\nTest message 33\n\n</message>\n
<time>May 15th at 9:00pm EDT</time>\n
<message id="34" from="[Alice](/human/alice)">\n\nTest message 34\n\n</message>\n
<time>May 15th at 10:00pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<time>May 15th at 11:00pm EDT</time>\n
<message id="36" from="[Alice](/human/alice)">\n\nTest message 36\n\n</message>\n
<time>May 16th at 12:00am EDT</time>\n
<message id="37" from="[Bob](/human/bob)">\n\nTest message 37\n\n</message>\n
<time>May 16th at 1:00am EDT</time>\n
<message id="38" from="[Alice](/human/alice)">\n\nTest message 38\n\n</message>\n
<time>May 16th at 2:00am EDT</time>\n
<message id="39" from="[Bob](/human/bob)">\n\nTest message 39\n\n</message>\n
<time>May 16th at 3:00am EDT</time>\n
<message id="40" from="[Alice](/human/alice)">\n\nTest message 40\n\n</message>\n
<time>May 16th at 4:00am EDT</time>\n
<message id="41" from="[Bob](/human/bob)">\n\nTest message 41\n\n</message>\n
<time>May 16th at 5:00am EDT</time>\n
<message id="42" from="[Alice](/human/alice)">\n\nTest message 42\n\n</message>\n
<time>May 16th at 6:00am EDT</time>\n
<message id="43" from="[Bob](/human/bob)">\n\nTest message 43\n\n</message>\n
<time>May 16th at 7:00am EDT</time>\n
<message id="44" from="[Alice](/human/alice)">\n\nTest message 44\n\n</message>\n
<time>May 16th at 8:00am EDT</time>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<time>May 16th at 9:00am EDT</time>\n
<message id="46" from="[Alice](/human/alice)">\n\nTest message 46\n\n</message>\n
<time>May 16th at 10:00am EDT</time>\n
<message id="47" from="[Bob](/human/bob)">\n\nTest message 47\n\n</message>\n
<time>May 16th at 11:00am EDT</time>\n
<message id="48" from="[Alice](/human/alice)">\n\nTest message 48\n\n</message>\n
<time>May 16th at 12:00pm EDT</time>\n
<message id="49" from="[Bob](/human/bob)">\n\nTest message 49\n\n</message>\n
<time>May 16th at 1:00pm EDT</time>\n
<message id="50" from="[Alice](/human/alice)">\n\nTest message 50\n\n</message>\n
<time>May 16th at 2:00pm EDT</time>\n
<message id="51" from="[Bob](/human/bob)">\n\nTest message 51\n\n</message>\n
<time>May 16th at 3:00pm EDT</time>\n
<message id="52" from="[Alice](/human/alice)">\n\nTest message 52\n\n</message>\n
<time>May 16th at 4:00pm EDT</time>\n
<message id="53" from="[Bob](/human/bob)">\n\nTest message 53\n\n</message>\n
<time>May 16th at 5:00pm EDT</time>\n
<message id="54" from="[Alice](/human/alice)">\n\nTest message 54\n\n</message>\n
<time>May 16th at 6:00pm EDT</time>\n
<message id="55" from="[Bob](/human/bob)">\n\nTest message 55\n\n</message>\n
<time>May 16th at 7:00pm EDT</time>\n
<message id="56" from="[Alice](/human/alice)">\n\nTest message 56\n\n</message>\n
<time>May 16th at 8:00pm EDT</time>\n
<message id="57" from="[Bob](/human/bob)">\n\nTest message 57\n\n</message>\n
<time>May 16th at 9:00pm EDT</time>\n
<message id="58" from="[Alice](/human/alice)">\n\nTest message 58\n\n</message>\n
<time>May 16th at 10:00pm EDT</time>\n
<message id="59" from="[Bob](/human/bob)">\n\nTest message 59\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=45",
            limit: "4kb",
            requests: [
                {limit: 30, cursor: 30},
                {from: "End" as const, limit: 15, cursor: 31},
                {limit: 15, cursor: 60},
            ],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=29) | [Next page »](/chat/incident-response?after=62)

<time>May 15th at 4:00pm EDT</time>\n
<message id="29" from="[Bob](/human/bob)">\n\nTest message 29\n\n</message>\n
<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<time>May 15th at 8:00pm EDT</time>\n
<message id="33" from="[Bob](/human/bob)">\n\nTest message 33\n\n</message>\n
<time>May 15th at 9:00pm EDT</time>\n
<message id="34" from="[Alice](/human/alice)">\n\nTest message 34\n\n</message>\n
<time>May 15th at 10:00pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<time>May 15th at 11:00pm EDT</time>\n
<message id="36" from="[Alice](/human/alice)">\n\nTest message 36\n\n</message>\n
<time>May 16th at 12:00am EDT</time>\n
<message id="37" from="[Bob](/human/bob)">\n\nTest message 37\n\n</message>\n
<time>May 16th at 1:00am EDT</time>\n
<message id="38" from="[Alice](/human/alice)">\n\nTest message 38\n\n</message>\n
<time>May 16th at 2:00am EDT</time>\n
<message id="39" from="[Bob](/human/bob)">\n\nTest message 39\n\n</message>\n
<time>May 16th at 3:00am EDT</time>\n
<message id="40" from="[Alice](/human/alice)">\n\nTest message 40\n\n</message>\n
<time>May 16th at 4:00am EDT</time>\n
<message id="41" from="[Bob](/human/bob)">\n\nTest message 41\n\n</message>\n
<time>May 16th at 5:00am EDT</time>\n
<message id="42" from="[Alice](/human/alice)">\n\nTest message 42\n\n</message>\n
<time>May 16th at 6:00am EDT</time>\n
<message id="43" from="[Bob](/human/bob)">\n\nTest message 43\n\n</message>\n
<time>May 16th at 7:00am EDT</time>\n
<message id="44" from="[Alice](/human/alice)">\n\nTest message 44\n\n</message>\n
<time>May 16th at 8:00am EDT</time>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<time>May 16th at 9:00am EDT</time>\n
<message id="46" from="[Alice](/human/alice)">\n\nTest message 46\n\n</message>\n
<time>May 16th at 10:00am EDT</time>\n
<message id="47" from="[Bob](/human/bob)">\n\nTest message 47\n\n</message>\n
<time>May 16th at 11:00am EDT</time>\n
<message id="48" from="[Alice](/human/alice)">\n\nTest message 48\n\n</message>\n
<time>May 16th at 12:00pm EDT</time>\n
<message id="49" from="[Bob](/human/bob)">\n\nTest message 49\n\n</message>\n
<time>May 16th at 1:00pm EDT</time>\n
<message id="50" from="[Alice](/human/alice)">\n\nTest message 50\n\n</message>\n
<time>May 16th at 2:00pm EDT</time>\n
<message id="51" from="[Bob](/human/bob)">\n\nTest message 51\n\n</message>\n
<time>May 16th at 3:00pm EDT</time>\n
<message id="52" from="[Alice](/human/alice)">\n\nTest message 52\n\n</message>\n
<time>May 16th at 4:00pm EDT</time>\n
<message id="53" from="[Bob](/human/bob)">\n\nTest message 53\n\n</message>\n
<time>May 16th at 5:00pm EDT</time>\n
<message id="54" from="[Alice](/human/alice)">\n\nTest message 54\n\n</message>\n
<time>May 16th at 6:00pm EDT</time>\n
<message id="55" from="[Bob](/human/bob)">\n\nTest message 55\n\n</message>\n
<time>May 16th at 7:00pm EDT</time>\n
<message id="56" from="[Alice](/human/alice)">\n\nTest message 56\n\n</message>\n
<time>May 16th at 8:00pm EDT</time>\n
<message id="57" from="[Bob](/human/bob)">\n\nTest message 57\n\n</message>\n
<time>May 16th at 9:00pm EDT</time>\n
<message id="58" from="[Alice](/human/alice)">\n\nTest message 58\n\n</message>\n
<time>May 16th at 10:00pm EDT</time>\n
<message id="59" from="[Bob](/human/bob)">\n\nTest message 59\n\n</message>\n
<time>May 16th at 11:00pm EDT</time>\n
<message id="60" from="[Alice](/human/alice)">\n\nTest message 60\n\n</message>\n
<time>May 17th at 12:00am EDT</time>\n
<message id="61" from="[Bob](/human/bob)">\n\nTest message 61\n\n</message>\n
<time>May 17th at 1:00am EDT</time>\n
<message id="62" from="[Alice](/human/alice)">\n\nTest message 62\n\n</message>`,
        },
    ])(
        "reads single message in the middle of a long message list when messages are more than an hour apart (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index =>
                        createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(
                                Date.UTC(2026, 4, 14, 15, index * 60),
                            ).toISOString(),
                        }),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=4",
            limit: "500b",
            requests: [{limit: 30, cursor: -11}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=3) | [Next page »](/chat/incident-response?after=5)

<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=4",
            limit: "1kb",
            requests: [{limit: 30, cursor: -11}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=1) | [Next page »](/chat/incident-response?after=7)

<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<time>May 14th at 1:00pm EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>\n
<time>May 14th at 5:00pm EDT</time>\n
<message id="6" from="[Alice](/human/alice)">\n\nTest message 6\n\n</message>\n
<time>May 14th at 6:00pm EDT</time>\n
<message id="7" from="[Bob](/human/bob)">\n\nTest message 7\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=4",
            limit: "3.414kb",
            requests: [{limit: 30, cursor: -11}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=28)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<time>May 14th at 1:00pm EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>\n
<time>May 14th at 5:00pm EDT</time>\n
<message id="6" from="[Alice](/human/alice)">\n\nTest message 6\n\n</message>\n
<time>May 14th at 6:00pm EDT</time>\n
<message id="7" from="[Bob](/human/bob)">\n\nTest message 7\n\n</message>\n
<time>May 14th at 7:00pm EDT</time>\n
<message id="8" from="[Alice](/human/alice)">\n\nTest message 8\n\n</message>\n
<time>May 14th at 8:00pm EDT</time>\n
<message id="9" from="[Bob](/human/bob)">\n\nTest message 9\n\n</message>\n
<time>May 14th at 9:00pm EDT</time>\n
<message id="10" from="[Alice](/human/alice)">\n\nTest message 10\n\n</message>\n
<time>May 14th at 10:00pm EDT</time>\n
<message id="11" from="[Bob](/human/bob)">\n\nTest message 11\n\n</message>\n
<time>May 14th at 11:00pm EDT</time>\n
<message id="12" from="[Alice](/human/alice)">\n\nTest message 12\n\n</message>\n
<time>May 15th at 12:00am EDT</time>\n
<message id="13" from="[Bob](/human/bob)">\n\nTest message 13\n\n</message>\n
<time>May 15th at 1:00am EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<time>May 15th at 2:00am EDT</time>\n
<message id="15" from="[Bob](/human/bob)">\n\nTest message 15\n\n</message>\n
<time>May 15th at 3:00am EDT</time>\n
<message id="16" from="[Alice](/human/alice)">\n\nTest message 16\n\n</message>\n
<time>May 15th at 4:00am EDT</time>\n
<message id="17" from="[Bob](/human/bob)">\n\nTest message 17\n\n</message>\n
<time>May 15th at 5:00am EDT</time>\n
<message id="18" from="[Alice](/human/alice)">\n\nTest message 18\n\n</message>\n
<time>May 15th at 6:00am EDT</time>\n
<message id="19" from="[Bob](/human/bob)">\n\nTest message 19\n\n</message>\n
<time>May 15th at 7:00am EDT</time>\n
<message id="20" from="[Alice](/human/alice)">\n\nTest message 20\n\n</message>\n
<time>May 15th at 8:00am EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<time>May 15th at 9:00am EDT</time>\n
<message id="22" from="[Alice](/human/alice)">\n\nTest message 22\n\n</message>\n
<time>May 15th at 10:00am EDT</time>\n
<message id="23" from="[Bob](/human/bob)">\n\nTest message 23\n\n</message>\n
<time>May 15th at 11:00am EDT</time>\n
<message id="24" from="[Alice](/human/alice)">\n\nTest message 24\n\n</message>\n
<time>May 15th at 12:00pm EDT</time>\n
<message id="25" from="[Bob](/human/bob)">\n\nTest message 25\n\n</message>\n
<time>May 15th at 1:00pm EDT</time>\n
<message id="26" from="[Alice](/human/alice)">\n\nTest message 26\n\n</message>\n
<time>May 15th at 2:00pm EDT</time>\n
<message id="27" from="[Bob](/human/bob)">\n\nTest message 27\n\n</message>\n
<time>May 15th at 3:00pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=4",
            limit: "4kb",
            requests: [
                {limit: 30, cursor: -11},
                {limit: 15, cursor: 29},
            ],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=33)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<time>May 14th at 1:00pm EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>\n
<time>May 14th at 5:00pm EDT</time>\n
<message id="6" from="[Alice](/human/alice)">\n\nTest message 6\n\n</message>\n
<time>May 14th at 6:00pm EDT</time>\n
<message id="7" from="[Bob](/human/bob)">\n\nTest message 7\n\n</message>\n
<time>May 14th at 7:00pm EDT</time>\n
<message id="8" from="[Alice](/human/alice)">\n\nTest message 8\n\n</message>\n
<time>May 14th at 8:00pm EDT</time>\n
<message id="9" from="[Bob](/human/bob)">\n\nTest message 9\n\n</message>\n
<time>May 14th at 9:00pm EDT</time>\n
<message id="10" from="[Alice](/human/alice)">\n\nTest message 10\n\n</message>\n
<time>May 14th at 10:00pm EDT</time>\n
<message id="11" from="[Bob](/human/bob)">\n\nTest message 11\n\n</message>\n
<time>May 14th at 11:00pm EDT</time>\n
<message id="12" from="[Alice](/human/alice)">\n\nTest message 12\n\n</message>\n
<time>May 15th at 12:00am EDT</time>\n
<message id="13" from="[Bob](/human/bob)">\n\nTest message 13\n\n</message>\n
<time>May 15th at 1:00am EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<time>May 15th at 2:00am EDT</time>\n
<message id="15" from="[Bob](/human/bob)">\n\nTest message 15\n\n</message>\n
<time>May 15th at 3:00am EDT</time>\n
<message id="16" from="[Alice](/human/alice)">\n\nTest message 16\n\n</message>\n
<time>May 15th at 4:00am EDT</time>\n
<message id="17" from="[Bob](/human/bob)">\n\nTest message 17\n\n</message>\n
<time>May 15th at 5:00am EDT</time>\n
<message id="18" from="[Alice](/human/alice)">\n\nTest message 18\n\n</message>\n
<time>May 15th at 6:00am EDT</time>\n
<message id="19" from="[Bob](/human/bob)">\n\nTest message 19\n\n</message>\n
<time>May 15th at 7:00am EDT</time>\n
<message id="20" from="[Alice](/human/alice)">\n\nTest message 20\n\n</message>\n
<time>May 15th at 8:00am EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<time>May 15th at 9:00am EDT</time>\n
<message id="22" from="[Alice](/human/alice)">\n\nTest message 22\n\n</message>\n
<time>May 15th at 10:00am EDT</time>\n
<message id="23" from="[Bob](/human/bob)">\n\nTest message 23\n\n</message>\n
<time>May 15th at 11:00am EDT</time>\n
<message id="24" from="[Alice](/human/alice)">\n\nTest message 24\n\n</message>\n
<time>May 15th at 12:00pm EDT</time>\n
<message id="25" from="[Bob](/human/bob)">\n\nTest message 25\n\n</message>\n
<time>May 15th at 1:00pm EDT</time>\n
<message id="26" from="[Alice](/human/alice)">\n\nTest message 26\n\n</message>\n
<time>May 15th at 2:00pm EDT</time>\n
<message id="27" from="[Bob](/human/bob)">\n\nTest message 27\n\n</message>\n
<time>May 15th at 3:00pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>\n
<time>May 15th at 4:00pm EDT</time>\n
<message id="29" from="[Bob](/human/bob)">\n\nTest message 29\n\n</message>\n
<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<time>May 15th at 8:00pm EDT</time>\n
<message id="33" from="[Bob](/human/bob)">\n\nTest message 33\n\n</message>`,
        },
    ])(
        "reads single message near the start of a long message list when messages are more than an hour apart (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index =>
                        createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(
                                Date.UTC(2026, 4, 14, 15, index * 60),
                            ).toISOString(),
                        }),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=0",
            limit: "500b",
            requests: [{limit: 30, cursor: -15}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=1)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=0",
            limit: "1kb",
            requests: [{limit: 30, cursor: -15}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=6)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<time>May 14th at 1:00pm EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>\n
<time>May 14th at 5:00pm EDT</time>\n
<message id="6" from="[Alice](/human/alice)">\n\nTest message 6\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=0",
            limit: "3.414kb",
            requests: [{limit: 30, cursor: -15}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=28)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<time>May 14th at 1:00pm EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>\n
<time>May 14th at 5:00pm EDT</time>\n
<message id="6" from="[Alice](/human/alice)">\n\nTest message 6\n\n</message>\n
<time>May 14th at 6:00pm EDT</time>\n
<message id="7" from="[Bob](/human/bob)">\n\nTest message 7\n\n</message>\n
<time>May 14th at 7:00pm EDT</time>\n
<message id="8" from="[Alice](/human/alice)">\n\nTest message 8\n\n</message>\n
<time>May 14th at 8:00pm EDT</time>\n
<message id="9" from="[Bob](/human/bob)">\n\nTest message 9\n\n</message>\n
<time>May 14th at 9:00pm EDT</time>\n
<message id="10" from="[Alice](/human/alice)">\n\nTest message 10\n\n</message>\n
<time>May 14th at 10:00pm EDT</time>\n
<message id="11" from="[Bob](/human/bob)">\n\nTest message 11\n\n</message>\n
<time>May 14th at 11:00pm EDT</time>\n
<message id="12" from="[Alice](/human/alice)">\n\nTest message 12\n\n</message>\n
<time>May 15th at 12:00am EDT</time>\n
<message id="13" from="[Bob](/human/bob)">\n\nTest message 13\n\n</message>\n
<time>May 15th at 1:00am EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<time>May 15th at 2:00am EDT</time>\n
<message id="15" from="[Bob](/human/bob)">\n\nTest message 15\n\n</message>\n
<time>May 15th at 3:00am EDT</time>\n
<message id="16" from="[Alice](/human/alice)">\n\nTest message 16\n\n</message>\n
<time>May 15th at 4:00am EDT</time>\n
<message id="17" from="[Bob](/human/bob)">\n\nTest message 17\n\n</message>\n
<time>May 15th at 5:00am EDT</time>\n
<message id="18" from="[Alice](/human/alice)">\n\nTest message 18\n\n</message>\n
<time>May 15th at 6:00am EDT</time>\n
<message id="19" from="[Bob](/human/bob)">\n\nTest message 19\n\n</message>\n
<time>May 15th at 7:00am EDT</time>\n
<message id="20" from="[Alice](/human/alice)">\n\nTest message 20\n\n</message>\n
<time>May 15th at 8:00am EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<time>May 15th at 9:00am EDT</time>\n
<message id="22" from="[Alice](/human/alice)">\n\nTest message 22\n\n</message>\n
<time>May 15th at 10:00am EDT</time>\n
<message id="23" from="[Bob](/human/bob)">\n\nTest message 23\n\n</message>\n
<time>May 15th at 11:00am EDT</time>\n
<message id="24" from="[Alice](/human/alice)">\n\nTest message 24\n\n</message>\n
<time>May 15th at 12:00pm EDT</time>\n
<message id="25" from="[Bob](/human/bob)">\n\nTest message 25\n\n</message>\n
<time>May 15th at 1:00pm EDT</time>\n
<message id="26" from="[Alice](/human/alice)">\n\nTest message 26\n\n</message>\n
<time>May 15th at 2:00pm EDT</time>\n
<message id="27" from="[Bob](/human/bob)">\n\nTest message 27\n\n</message>\n
<time>May 15th at 3:00pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=0",
            limit: "4kb",
            requests: [
                {limit: 30, cursor: -15},
                {limit: 15, cursor: 29},
            ],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=33)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<time>May 14th at 1:00pm EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>\n
<time>May 14th at 5:00pm EDT</time>\n
<message id="6" from="[Alice](/human/alice)">\n\nTest message 6\n\n</message>\n
<time>May 14th at 6:00pm EDT</time>\n
<message id="7" from="[Bob](/human/bob)">\n\nTest message 7\n\n</message>\n
<time>May 14th at 7:00pm EDT</time>\n
<message id="8" from="[Alice](/human/alice)">\n\nTest message 8\n\n</message>\n
<time>May 14th at 8:00pm EDT</time>\n
<message id="9" from="[Bob](/human/bob)">\n\nTest message 9\n\n</message>\n
<time>May 14th at 9:00pm EDT</time>\n
<message id="10" from="[Alice](/human/alice)">\n\nTest message 10\n\n</message>\n
<time>May 14th at 10:00pm EDT</time>\n
<message id="11" from="[Bob](/human/bob)">\n\nTest message 11\n\n</message>\n
<time>May 14th at 11:00pm EDT</time>\n
<message id="12" from="[Alice](/human/alice)">\n\nTest message 12\n\n</message>\n
<time>May 15th at 12:00am EDT</time>\n
<message id="13" from="[Bob](/human/bob)">\n\nTest message 13\n\n</message>\n
<time>May 15th at 1:00am EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<time>May 15th at 2:00am EDT</time>\n
<message id="15" from="[Bob](/human/bob)">\n\nTest message 15\n\n</message>\n
<time>May 15th at 3:00am EDT</time>\n
<message id="16" from="[Alice](/human/alice)">\n\nTest message 16\n\n</message>\n
<time>May 15th at 4:00am EDT</time>\n
<message id="17" from="[Bob](/human/bob)">\n\nTest message 17\n\n</message>\n
<time>May 15th at 5:00am EDT</time>\n
<message id="18" from="[Alice](/human/alice)">\n\nTest message 18\n\n</message>\n
<time>May 15th at 6:00am EDT</time>\n
<message id="19" from="[Bob](/human/bob)">\n\nTest message 19\n\n</message>\n
<time>May 15th at 7:00am EDT</time>\n
<message id="20" from="[Alice](/human/alice)">\n\nTest message 20\n\n</message>\n
<time>May 15th at 8:00am EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<time>May 15th at 9:00am EDT</time>\n
<message id="22" from="[Alice](/human/alice)">\n\nTest message 22\n\n</message>\n
<time>May 15th at 10:00am EDT</time>\n
<message id="23" from="[Bob](/human/bob)">\n\nTest message 23\n\n</message>\n
<time>May 15th at 11:00am EDT</time>\n
<message id="24" from="[Alice](/human/alice)">\n\nTest message 24\n\n</message>\n
<time>May 15th at 12:00pm EDT</time>\n
<message id="25" from="[Bob](/human/bob)">\n\nTest message 25\n\n</message>\n
<time>May 15th at 1:00pm EDT</time>\n
<message id="26" from="[Alice](/human/alice)">\n\nTest message 26\n\n</message>\n
<time>May 15th at 2:00pm EDT</time>\n
<message id="27" from="[Bob](/human/bob)">\n\nTest message 27\n\n</message>\n
<time>May 15th at 3:00pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>\n
<time>May 15th at 4:00pm EDT</time>\n
<message id="29" from="[Bob](/human/bob)">\n\nTest message 29\n\n</message>\n
<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<time>May 15th at 8:00pm EDT</time>\n
<message id="33" from="[Bob](/human/bob)">\n\nTest message 33\n\n</message>`,
        },
    ])(
        "reads single message at the start of a long message list when messages are more than an hour apart (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index =>
                        createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(
                                Date.UTC(2026, 4, 14, 15, index * 60),
                            ).toISOString(),
                        }),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=85",
            limit: "500b",
            requests: [{limit: 30, cursor: 70}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=84) | [Next page »](/chat/incident-response?after=86)

<time>May 17th at 11:00pm EDT</time>\n
<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<time>May 18th at 12:00am EDT</time>\n
<message id="85" from="[Bob](/human/bob)">\n\nTest message 85\n\n</message>\n
<time>May 18th at 1:00am EDT</time>\n
<message id="86" from="[Alice](/human/alice)">\n\nTest message 86\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=85",
            limit: "1kb",
            requests: [{limit: 30, cursor: 70}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=82) | [Next page »](/chat/incident-response?after=88)

<time>May 17th at 9:00pm EDT</time>\n
<message id="82" from="[Alice](/human/alice)">\n\nTest message 82\n\n</message>\n
<time>May 17th at 10:00pm EDT</time>\n
<message id="83" from="[Bob](/human/bob)">\n\nTest message 83\n\n</message>\n
<time>May 17th at 11:00pm EDT</time>\n
<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<time>May 18th at 12:00am EDT</time>\n
<message id="85" from="[Bob](/human/bob)">\n\nTest message 85\n\n</message>\n
<time>May 18th at 1:00am EDT</time>\n
<message id="86" from="[Alice](/human/alice)">\n\nTest message 86\n\n</message>\n
<time>May 18th at 2:00am EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<time>May 18th at 3:00am EDT</time>\n
<message id="88" from="[Alice](/human/alice)">\n\nTest message 88\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=85",
            limit: "2.221kb",
            requests: [{limit: 30, cursor: 70}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=72)

<time>May 17th at 11:00am EDT</time>\n
<message id="72" from="[Alice](/human/alice)">\n\nTest message 72\n\n</message>\n
<time>May 17th at 12:00pm EDT</time>\n
<message id="73" from="[Bob](/human/bob)">\n\nTest message 73\n\n</message>\n
<time>May 17th at 1:00pm EDT</time>\n
<message id="74" from="[Alice](/human/alice)">\n\nTest message 74\n\n</message>\n
<time>May 17th at 2:00pm EDT</time>\n
<message id="75" from="[Bob](/human/bob)">\n\nTest message 75\n\n</message>\n
<time>May 17th at 3:00pm EDT</time>\n
<message id="76" from="[Alice](/human/alice)">\n\nTest message 76\n\n</message>\n
<time>May 17th at 4:00pm EDT</time>\n
<message id="77" from="[Bob](/human/bob)">\n\nTest message 77\n\n</message>\n
<time>May 17th at 5:00pm EDT</time>\n
<message id="78" from="[Alice](/human/alice)">\n\nTest message 78\n\n</message>\n
<time>May 17th at 6:00pm EDT</time>\n
<message id="79" from="[Bob](/human/bob)">\n\nTest message 79\n\n</message>\n
<time>May 17th at 7:00pm EDT</time>\n
<message id="80" from="[Alice](/human/alice)">\n\nTest message 80\n\n</message>\n
<time>May 17th at 8:00pm EDT</time>\n
<message id="81" from="[Bob](/human/bob)">\n\nTest message 81\n\n</message>\n
<time>May 17th at 9:00pm EDT</time>\n
<message id="82" from="[Alice](/human/alice)">\n\nTest message 82\n\n</message>\n
<time>May 17th at 10:00pm EDT</time>\n
<message id="83" from="[Bob](/human/bob)">\n\nTest message 83\n\n</message>\n
<time>May 17th at 11:00pm EDT</time>\n
<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<time>May 18th at 12:00am EDT</time>\n
<message id="85" from="[Bob](/human/bob)">\n\nTest message 85\n\n</message>\n
<time>May 18th at 1:00am EDT</time>\n
<message id="86" from="[Alice](/human/alice)">\n\nTest message 86\n\n</message>\n
<time>May 18th at 2:00am EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<time>May 18th at 3:00am EDT</time>\n
<message id="88" from="[Alice](/human/alice)">\n\nTest message 88\n\n</message>\n
<time>May 18th at 4:00am EDT</time>\n
<message id="89" from="[Bob](/human/bob)">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=85",
            limit: "3kb",
            requests: [
                {limit: 30, cursor: 70},
                {from: "End" as const, limit: 15, cursor: 71},
            ],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=65)

<time>May 17th at 4:00am EDT</time>\n
<message id="65" from="[Bob](/human/bob)">\n\nTest message 65\n\n</message>\n
<time>May 17th at 5:00am EDT</time>\n
<message id="66" from="[Alice](/human/alice)">\n\nTest message 66\n\n</message>\n
<time>May 17th at 6:00am EDT</time>\n
<message id="67" from="[Bob](/human/bob)">\n\nTest message 67\n\n</message>\n
<time>May 17th at 7:00am EDT</time>\n
<message id="68" from="[Alice](/human/alice)">\n\nTest message 68\n\n</message>\n
<time>May 17th at 8:00am EDT</time>\n
<message id="69" from="[Bob](/human/bob)">\n\nTest message 69\n\n</message>\n
<time>May 17th at 9:00am EDT</time>\n
<message id="70" from="[Alice](/human/alice)">\n\nTest message 70\n\n</message>\n
<time>May 17th at 10:00am EDT</time>\n
<message id="71" from="[Bob](/human/bob)">\n\nTest message 71\n\n</message>\n
<time>May 17th at 11:00am EDT</time>\n
<message id="72" from="[Alice](/human/alice)">\n\nTest message 72\n\n</message>\n
<time>May 17th at 12:00pm EDT</time>\n
<message id="73" from="[Bob](/human/bob)">\n\nTest message 73\n\n</message>\n
<time>May 17th at 1:00pm EDT</time>\n
<message id="74" from="[Alice](/human/alice)">\n\nTest message 74\n\n</message>\n
<time>May 17th at 2:00pm EDT</time>\n
<message id="75" from="[Bob](/human/bob)">\n\nTest message 75\n\n</message>\n
<time>May 17th at 3:00pm EDT</time>\n
<message id="76" from="[Alice](/human/alice)">\n\nTest message 76\n\n</message>\n
<time>May 17th at 4:00pm EDT</time>\n
<message id="77" from="[Bob](/human/bob)">\n\nTest message 77\n\n</message>\n
<time>May 17th at 5:00pm EDT</time>\n
<message id="78" from="[Alice](/human/alice)">\n\nTest message 78\n\n</message>\n
<time>May 17th at 6:00pm EDT</time>\n
<message id="79" from="[Bob](/human/bob)">\n\nTest message 79\n\n</message>\n
<time>May 17th at 7:00pm EDT</time>\n
<message id="80" from="[Alice](/human/alice)">\n\nTest message 80\n\n</message>\n
<time>May 17th at 8:00pm EDT</time>\n
<message id="81" from="[Bob](/human/bob)">\n\nTest message 81\n\n</message>\n
<time>May 17th at 9:00pm EDT</time>\n
<message id="82" from="[Alice](/human/alice)">\n\nTest message 82\n\n</message>\n
<time>May 17th at 10:00pm EDT</time>\n
<message id="83" from="[Bob](/human/bob)">\n\nTest message 83\n\n</message>\n
<time>May 17th at 11:00pm EDT</time>\n
<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<time>May 18th at 12:00am EDT</time>\n
<message id="85" from="[Bob](/human/bob)">\n\nTest message 85\n\n</message>\n
<time>May 18th at 1:00am EDT</time>\n
<message id="86" from="[Alice](/human/alice)">\n\nTest message 86\n\n</message>\n
<time>May 18th at 2:00am EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<time>May 18th at 3:00am EDT</time>\n
<message id="88" from="[Alice](/human/alice)">\n\nTest message 88\n\n</message>\n
<time>May 18th at 4:00am EDT</time>\n
<message id="89" from="[Bob](/human/bob)">\n\nTest message 89\n\n</message>

End of messages.`,
        },
    ])(
        "reads single message near the end of a long message list when messages are more than an hour apart (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index =>
                        createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(
                                Date.UTC(2026, 4, 14, 15, index * 60),
                            ).toISOString(),
                        }),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=89",
            limit: "500b",
            requests: [{limit: 30, cursor: 74}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=87)

<time>May 18th at 2:00am EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<time>May 18th at 3:00am EDT</time>\n
<message id="88" from="[Alice](/human/alice)">\n\nTest message 88\n\n</message>\n
<time>May 18th at 4:00am EDT</time>\n
<message id="89" from="[Bob](/human/bob)">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=89",
            limit: "1kb",
            requests: [{limit: 30, cursor: 74}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=83)

<time>May 17th at 10:00pm EDT</time>\n
<message id="83" from="[Bob](/human/bob)">\n\nTest message 83\n\n</message>\n
<time>May 17th at 11:00pm EDT</time>\n
<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<time>May 18th at 12:00am EDT</time>\n
<message id="85" from="[Bob](/human/bob)">\n\nTest message 85\n\n</message>\n
<time>May 18th at 1:00am EDT</time>\n
<message id="86" from="[Alice](/human/alice)">\n\nTest message 86\n\n</message>\n
<time>May 18th at 2:00am EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<time>May 18th at 3:00am EDT</time>\n
<message id="88" from="[Alice](/human/alice)">\n\nTest message 88\n\n</message>\n
<time>May 18th at 4:00am EDT</time>\n
<message id="89" from="[Bob](/human/bob)">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=89",
            limit: "1.77kb",
            requests: [{limit: 30, cursor: 74}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=76)

<time>May 17th at 3:00pm EDT</time>\n
<message id="76" from="[Alice](/human/alice)">\n\nTest message 76\n\n</message>\n
<time>May 17th at 4:00pm EDT</time>\n
<message id="77" from="[Bob](/human/bob)">\n\nTest message 77\n\n</message>\n
<time>May 17th at 5:00pm EDT</time>\n
<message id="78" from="[Alice](/human/alice)">\n\nTest message 78\n\n</message>\n
<time>May 17th at 6:00pm EDT</time>\n
<message id="79" from="[Bob](/human/bob)">\n\nTest message 79\n\n</message>\n
<time>May 17th at 7:00pm EDT</time>\n
<message id="80" from="[Alice](/human/alice)">\n\nTest message 80\n\n</message>\n
<time>May 17th at 8:00pm EDT</time>\n
<message id="81" from="[Bob](/human/bob)">\n\nTest message 81\n\n</message>\n
<time>May 17th at 9:00pm EDT</time>\n
<message id="82" from="[Alice](/human/alice)">\n\nTest message 82\n\n</message>\n
<time>May 17th at 10:00pm EDT</time>\n
<message id="83" from="[Bob](/human/bob)">\n\nTest message 83\n\n</message>\n
<time>May 17th at 11:00pm EDT</time>\n
<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<time>May 18th at 12:00am EDT</time>\n
<message id="85" from="[Bob](/human/bob)">\n\nTest message 85\n\n</message>\n
<time>May 18th at 1:00am EDT</time>\n
<message id="86" from="[Alice](/human/alice)">\n\nTest message 86\n\n</message>\n
<time>May 18th at 2:00am EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<time>May 18th at 3:00am EDT</time>\n
<message id="88" from="[Alice](/human/alice)">\n\nTest message 88\n\n</message>\n
<time>May 18th at 4:00am EDT</time>\n
<message id="89" from="[Bob](/human/bob)">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=89",
            limit: "2kb",
            requests: [
                {limit: 30, cursor: 74},
                {from: "End" as const, limit: 15, cursor: 75},
            ],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=74)

<time>May 17th at 1:00pm EDT</time>\n
<message id="74" from="[Alice](/human/alice)">\n\nTest message 74\n\n</message>\n
<time>May 17th at 2:00pm EDT</time>\n
<message id="75" from="[Bob](/human/bob)">\n\nTest message 75\n\n</message>\n
<time>May 17th at 3:00pm EDT</time>\n
<message id="76" from="[Alice](/human/alice)">\n\nTest message 76\n\n</message>\n
<time>May 17th at 4:00pm EDT</time>\n
<message id="77" from="[Bob](/human/bob)">\n\nTest message 77\n\n</message>\n
<time>May 17th at 5:00pm EDT</time>\n
<message id="78" from="[Alice](/human/alice)">\n\nTest message 78\n\n</message>\n
<time>May 17th at 6:00pm EDT</time>\n
<message id="79" from="[Bob](/human/bob)">\n\nTest message 79\n\n</message>\n
<time>May 17th at 7:00pm EDT</time>\n
<message id="80" from="[Alice](/human/alice)">\n\nTest message 80\n\n</message>\n
<time>May 17th at 8:00pm EDT</time>\n
<message id="81" from="[Bob](/human/bob)">\n\nTest message 81\n\n</message>\n
<time>May 17th at 9:00pm EDT</time>\n
<message id="82" from="[Alice](/human/alice)">\n\nTest message 82\n\n</message>\n
<time>May 17th at 10:00pm EDT</time>\n
<message id="83" from="[Bob](/human/bob)">\n\nTest message 83\n\n</message>\n
<time>May 17th at 11:00pm EDT</time>\n
<message id="84" from="[Alice](/human/alice)">\n\nTest message 84\n\n</message>\n
<time>May 18th at 12:00am EDT</time>\n
<message id="85" from="[Bob](/human/bob)">\n\nTest message 85\n\n</message>\n
<time>May 18th at 1:00am EDT</time>\n
<message id="86" from="[Alice](/human/alice)">\n\nTest message 86\n\n</message>\n
<time>May 18th at 2:00am EDT</time>\n
<message id="87" from="[Bob](/human/bob)">\n\nTest message 87\n\n</message>\n
<time>May 18th at 3:00am EDT</time>\n
<message id="88" from="[Alice](/human/alice)">\n\nTest message 88\n\n</message>\n
<time>May 18th at 4:00am EDT</time>\n
<message id="89" from="[Bob](/human/bob)">\n\nTest message 89\n\n</message>

End of messages.`,
        },
    ])(
        "reads single message at the end of a long message list when messages are more than an hour apart (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index =>
                        createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(
                                Date.UTC(2026, 4, 14, 15, index * 60),
                            ).toISOString(),
                        }),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=4",
            limit: "500b",
            requests: [{limit: 30, cursor: -11}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=3) | [Next page »](/chat/incident-response?after=5)

<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=4",
            limit: "1kb",
            requests: [{limit: 30, cursor: -11}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=1) | [Next page »](/chat/incident-response?after=7)

<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<time>May 14th at 1:00pm EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>\n
<time>May 14th at 5:00pm EDT</time>\n
<message id="6" from="[Alice](/human/alice)">\n\nTest message 6\n\n</message>\n
<time>May 14th at 6:00pm EDT</time>\n
<message id="7" from="[Bob](/human/bob)">\n\nTest message 7\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=4",
            limit: "3.414kb",
            requests: [{limit: 30, cursor: -11}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=28)

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<time>May 14th at 1:00pm EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>\n
<time>May 14th at 5:00pm EDT</time>\n
<message id="6" from="[Alice](/human/alice)">\n\nTest message 6\n\n</message>\n
<time>May 14th at 6:00pm EDT</time>\n
<message id="7" from="[Bob](/human/bob)">\n\nTest message 7\n\n</message>\n
<time>May 14th at 7:00pm EDT</time>\n
<message id="8" from="[Alice](/human/alice)">\n\nTest message 8\n\n</message>\n
<time>May 14th at 8:00pm EDT</time>\n
<message id="9" from="[Bob](/human/bob)">\n\nTest message 9\n\n</message>\n
<time>May 14th at 9:00pm EDT</time>\n
<message id="10" from="[Alice](/human/alice)">\n\nTest message 10\n\n</message>\n
<time>May 14th at 10:00pm EDT</time>\n
<message id="11" from="[Bob](/human/bob)">\n\nTest message 11\n\n</message>\n
<time>May 14th at 11:00pm EDT</time>\n
<message id="12" from="[Alice](/human/alice)">\n\nTest message 12\n\n</message>\n
<time>May 15th at 12:00am EDT</time>\n
<message id="13" from="[Bob](/human/bob)">\n\nTest message 13\n\n</message>\n
<time>May 15th at 1:00am EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<time>May 15th at 2:00am EDT</time>\n
<message id="15" from="[Bob](/human/bob)">\n\nTest message 15\n\n</message>\n
<time>May 15th at 3:00am EDT</time>\n
<message id="16" from="[Alice](/human/alice)">\n\nTest message 16\n\n</message>\n
<time>May 15th at 4:00am EDT</time>\n
<message id="17" from="[Bob](/human/bob)">\n\nTest message 17\n\n</message>\n
<time>May 15th at 5:00am EDT</time>\n
<message id="18" from="[Alice](/human/alice)">\n\nTest message 18\n\n</message>\n
<time>May 15th at 6:00am EDT</time>\n
<message id="19" from="[Bob](/human/bob)">\n\nTest message 19\n\n</message>\n
<time>May 15th at 7:00am EDT</time>\n
<message id="20" from="[Alice](/human/alice)">\n\nTest message 20\n\n</message>\n
<time>May 15th at 8:00am EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<time>May 15th at 9:00am EDT</time>\n
<message id="22" from="[Alice](/human/alice)">\n\nTest message 22\n\n</message>\n
<time>May 15th at 10:00am EDT</time>\n
<message id="23" from="[Bob](/human/bob)">\n\nTest message 23\n\n</message>\n
<time>May 15th at 11:00am EDT</time>\n
<message id="24" from="[Alice](/human/alice)">\n\nTest message 24\n\n</message>\n
<time>May 15th at 12:00pm EDT</time>\n
<message id="25" from="[Bob](/human/bob)">\n\nTest message 25\n\n</message>\n
<time>May 15th at 1:00pm EDT</time>\n
<message id="26" from="[Alice](/human/alice)">\n\nTest message 26\n\n</message>\n
<time>May 15th at 2:00pm EDT</time>\n
<message id="27" from="[Bob](/human/bob)">\n\nTest message 27\n\n</message>\n
<time>May 15th at 3:00pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=4",
            limit: "5kb",
            requests: [
                {limit: 30, cursor: -11},
                {limit: 15, cursor: 29},
            ],
            response: `\
# Incident Response

<time>May 14th at 11:00am EDT</time>\n
<message id="0" from="[Alice](/human/alice)">\n\nTest message 0\n\n</message>\n
<time>May 14th at 12:00pm EDT</time>\n
<message id="1" from="[Bob](/human/bob)">\n\nTest message 1\n\n</message>\n
<time>May 14th at 1:00pm EDT</time>\n
<message id="2" from="[Alice](/human/alice)">\n\nTest message 2\n\n</message>\n
<time>May 14th at 2:00pm EDT</time>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<time>May 14th at 3:00pm EDT</time>\n
<message id="4" from="[Alice](/human/alice)">\n\nTest message 4\n\n</message>\n
<time>May 14th at 4:00pm EDT</time>\n
<message id="5" from="[Bob](/human/bob)">\n\nTest message 5\n\n</message>\n
<time>May 14th at 5:00pm EDT</time>\n
<message id="6" from="[Alice](/human/alice)">\n\nTest message 6\n\n</message>\n
<time>May 14th at 6:00pm EDT</time>\n
<message id="7" from="[Bob](/human/bob)">\n\nTest message 7\n\n</message>\n
<time>May 14th at 7:00pm EDT</time>\n
<message id="8" from="[Alice](/human/alice)">\n\nTest message 8\n\n</message>\n
<time>May 14th at 8:00pm EDT</time>\n
<message id="9" from="[Bob](/human/bob)">\n\nTest message 9\n\n</message>\n
<time>May 14th at 9:00pm EDT</time>\n
<message id="10" from="[Alice](/human/alice)">\n\nTest message 10\n\n</message>\n
<time>May 14th at 10:00pm EDT</time>\n
<message id="11" from="[Bob](/human/bob)">\n\nTest message 11\n\n</message>\n
<time>May 14th at 11:00pm EDT</time>\n
<message id="12" from="[Alice](/human/alice)">\n\nTest message 12\n\n</message>\n
<time>May 15th at 12:00am EDT</time>\n
<message id="13" from="[Bob](/human/bob)">\n\nTest message 13\n\n</message>\n
<time>May 15th at 1:00am EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<time>May 15th at 2:00am EDT</time>\n
<message id="15" from="[Bob](/human/bob)">\n\nTest message 15\n\n</message>\n
<time>May 15th at 3:00am EDT</time>\n
<message id="16" from="[Alice](/human/alice)">\n\nTest message 16\n\n</message>\n
<time>May 15th at 4:00am EDT</time>\n
<message id="17" from="[Bob](/human/bob)">\n\nTest message 17\n\n</message>\n
<time>May 15th at 5:00am EDT</time>\n
<message id="18" from="[Alice](/human/alice)">\n\nTest message 18\n\n</message>\n
<time>May 15th at 6:00am EDT</time>\n
<message id="19" from="[Bob](/human/bob)">\n\nTest message 19\n\n</message>\n
<time>May 15th at 7:00am EDT</time>\n
<message id="20" from="[Alice](/human/alice)">\n\nTest message 20\n\n</message>\n
<time>May 15th at 8:00am EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<time>May 15th at 9:00am EDT</time>\n
<message id="22" from="[Alice](/human/alice)">\n\nTest message 22\n\n</message>\n
<time>May 15th at 10:00am EDT</time>\n
<message id="23" from="[Bob](/human/bob)">\n\nTest message 23\n\n</message>\n
<time>May 15th at 11:00am EDT</time>\n
<message id="24" from="[Alice](/human/alice)">\n\nTest message 24\n\n</message>\n
<time>May 15th at 12:00pm EDT</time>\n
<message id="25" from="[Bob](/human/bob)">\n\nTest message 25\n\n</message>\n
<time>May 15th at 1:00pm EDT</time>\n
<message id="26" from="[Alice](/human/alice)">\n\nTest message 26\n\n</message>\n
<time>May 15th at 2:00pm EDT</time>\n
<message id="27" from="[Bob](/human/bob)">\n\nTest message 27\n\n</message>\n
<time>May 15th at 3:00pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>\n
<time>May 15th at 4:00pm EDT</time>\n
<message id="29" from="[Bob](/human/bob)">\n\nTest message 29\n\n</message>\n
<time>May 15th at 5:00pm EDT</time>\n
<message id="30" from="[Alice](/human/alice)">\n\nTest message 30\n\n</message>\n
<time>May 15th at 6:00pm EDT</time>\n
<message id="31" from="[Bob](/human/bob)">\n\nTest message 31\n\n</message>\n
<time>May 15th at 7:00pm EDT</time>\n
<message id="32" from="[Alice](/human/alice)">\n\nTest message 32\n\n</message>\n
<time>May 15th at 8:00pm EDT</time>\n
<message id="33" from="[Bob](/human/bob)">\n\nTest message 33\n\n</message>\n
<time>May 15th at 9:00pm EDT</time>\n
<message id="34" from="[Alice](/human/alice)">\n\nTest message 34\n\n</message>\n
<time>May 15th at 10:00pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<time>May 15th at 11:00pm EDT</time>\n
<message id="36" from="[Alice](/human/alice)">\n\nTest message 36\n\n</message>\n
<time>May 16th at 12:00am EDT</time>\n
<message id="37" from="[Bob](/human/bob)">\n\nTest message 37\n\n</message>\n
<time>May 16th at 1:00am EDT</time>\n
<message id="38" from="[Alice](/human/alice)">\n\nTest message 38\n\n</message>\n
<time>May 16th at 2:00am EDT</time>\n
<message id="39" from="[Bob](/human/bob)">\n\nTest message 39\n\n</message>

End of messages.`,
        },
    ])(
        "reads single message in a small message list when messages are more than an hour apart (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 40,
                    ...request,
                    createMessage: index =>
                        createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(
                                Date.UTC(2026, 4, 14, 15, index * 60),
                            ).toISOString(),
                        }),
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response",
            limit: "500b",
            requests: [{from: "End" as const, limit: 30}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=84)

<time>May 15th at 12:25pm EDT</time>\n
<message id="84-87" from="[Alice](/human/alice)">\n\nTest message 84\n\nTest message 85\n\nTest message 86\n\nTest message 87\n\n</message>\n
<message id="88" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response",
            limit: "750b",
            requests: [{from: "End" as const, limit: 30}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=82)

<time>May 15th at 10:49am EDT</time>\n
<message id="82" from="[Alice](/human/alice)">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 83\n\n</message>\n
<time>May 15th at 12:25pm EDT</time>\n
<message id="84-87" from="[Alice](/human/alice)">\n\nTest message 84\n\nTest message 85\n\nTest message 86\n\nTest message 87\n\n</message>\n
<message id="88" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response",
            limit: "3.454kb",
            requests: [
                {from: "End" as const, limit: 30},
                {from: "End" as const, limit: 30, cursor: 60},
            ],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=48)

<time>May 15th at 12:46am EDT</time>\n
<message id="48" from="[Alice](/human/alice)">\n\nTest message 48\n\n</message>\n
<time>May 15th at 1:50am EDT</time>\n
<message id="49" from="[Bob](/human/bob)">\n\nTest message 49\n\n</message>\n
<message id="50-51" from="[Alice](/human/alice)">\n\nTest message 50\n\nTest message 51\n\n</message>\n
<message id="52" from="[Bob](/human/bob)">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 55\n\n</message>\n
<time>May 15th at 3:57am EDT</time>\n
<message id="56" from="[Alice](/human/alice)">\n\nTest message 56\n\n</message>\n
<message id="57-58" from="[Bob](/human/bob)">\n\nTest message 57\n\nTest message 58\n\n</message>\n
<message id="59" from="[Alice](/human/alice)">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 62\n\n</message>\n
<time>May 15th at 6:04am EDT</time>\n
<message id="63-66" from="[Bob](/human/bob)">\n\nTest message 63\n\nTest message 64\n\nTest message 65\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 69\n\n</message>\n
<time>May 15th at 8:11am EDT</time>\n
<message id="70" from="[Alice](/human/alice)">\n\nTest message 70\n\n</message>\n
<message id="71-72" from="[Bob](/human/bob)">\n\nTest message 71\n\nTest message 72\n\n</message>\n
<message id="73" from="[Alice](/human/alice)">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 76\n\n</message>\n
<time>May 15th at 10:18am EDT</time>\n
<message id="77" from="[Bob](/human/bob)">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)">\n\nTest message 78\n\n</message>\n
<message id="79-80" from="[Bob](/human/bob)">\n\nTest message 79\n\nTest message 80\n\n</message>\n
<message id="81" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 83\n\n</message>\n
<time>May 15th at 12:25pm EDT</time>\n
<message id="84-87" from="[Alice](/human/alice)">\n\nTest message 84\n\nTest message 85\n\nTest message 86\n\nTest message 87\n\n</message>\n
<message id="88" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
    ])(
        "reads messages from end when adjacent messages may merge (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => {
                        // Add minutes in increments of 1, 2, 4, 8, 16, 32, 64 and then loop back to 1.
                        const minutes = Math.floor(index / 7) * 127 + 2 ** (index % 7);

                        const author = stableRandomBit(index) === 0 ? aliceAccount : bobAccount;

                        return createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(Date.UTC(2026, 4, 14, 15, minutes)).toISOString(),
                        });
                    },
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?start",
            limit: "500b",
            requests: [{limit: 30}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=5)

<time>May 14th at 11:01am EDT</time>\n
<message id="0-2" from="[Alice](/human/alice)">\n\nTest message 0\n\nTest message 1\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 5\n\n</message>`,
        },
        {
            path: "/chat/incident-response?start",
            limit: "750b",
            requests: [{limit: 30}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=7)

<time>May 14th at 11:01am EDT</time>\n
<message id="0-2" from="[Alice](/human/alice)">\n\nTest message 0\n\nTest message 1\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 6\n\n</message>\n
<time>May 14th at 1:08pm EDT</time>\n
<message id="7" from="[Alice](/human/alice)">\n\nTest message 7\n\n</message>`,
        },
        {
            path: "/chat/incident-response?start",
            limit: "3.404kb",
            requests: [{limit: 30}, {limit: 30, cursor: 29}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=40)

<time>May 14th at 11:01am EDT</time>\n
<message id="0-2" from="[Alice](/human/alice)">\n\nTest message 0\n\nTest message 1\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 6\n\n</message>\n
<time>May 14th at 1:08pm EDT</time>\n
<message id="7" from="[Alice](/human/alice)">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Bob](/human/bob)">\n\nTest message 8\n\n</message>\n
<message id="9-10" from="[Alice](/human/alice)">\n\nTest message 9\n\nTest message 10\n\n</message>\n
<message id="11" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 13\n\n</message>\n
<time>May 14th at 3:15pm EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)">\n\nTest message 15\n\n</message>\n
<message id="16-17" from="[Alice](/human/alice)">\n\nTest message 16\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 20\n\n</message>\n
<time>May 14th at 5:22pm EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<message id="22-24" from="[Alice](/human/alice)">\n\nTest message 22\n\nTest message 23\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 27\n\n</message>\n
<time>May 14th at 7:29pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>\n
<message id="29-30" from="[Bob](/human/bob)">\n\nTest message 29\n\nTest message 30\n\n</message>\n
<message id="31" from="[Alice](/human/alice)">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 34\n\n</message>\n
<time>May 14th at 9:36pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<message id="36-37" from="[Alice](/human/alice)">\n\nTest message 36\n\nTest message 37\n\n</message>\n
<message id="38" from="[Bob](/human/bob)">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 40\n\n</message>`,
        },
    ])(
        "reads messages from start when adjacent messages may merge (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => {
                        // Add minutes in increments of 1, 2, 4, 8, 16, 32, 64 and then loop back to 1.
                        const minutes = Math.floor(index / 7) * 127 + 2 ** (index % 7);

                        const author = stableRandomBit(index) === 0 ? aliceAccount : bobAccount;

                        return createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(Date.UTC(2026, 4, 14, 15, minutes)).toISOString(),
                        });
                    },
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?before=67",
            requestCount: 1,
            limit: "500b",
            requests: [{from: "End" as const, limit: 30, cursor: 67}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=61)

<time>May 15th at 4:28am EDT</time>\n
<message id="61" from="[Bob](/human/bob)">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 62\n\n</message>\n
<time>May 15th at 6:04am EDT</time>\n
<message id="63-66" from="[Bob](/human/bob)">\n\nTest message 63\n\nTest message 64\n\nTest message 65\n\nTest message 66\n\n</message>`,
        },
        {
            path: "/chat/incident-response?before=67",
            requestCount: 1,
            limit: "734b",
            requests: [{from: "End" as const, limit: 30, cursor: 67}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=59)

<time>May 15th at 4:04am EDT</time>\n
<message id="59" from="[Alice](/human/alice)">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 62\n\n</message>\n
<time>May 15th at 6:04am EDT</time>\n
<message id="63-66" from="[Bob](/human/bob)">\n\nTest message 63\n\nTest message 64\n\nTest message 65\n\nTest message 66\n\n</message>`,
        },
        {
            path: "/chat/incident-response?before=67",
            requestCount: 2,
            limit: "3.984kb",
            requests: [
                {from: "End" as const, limit: 30, cursor: 67},
                {from: "End" as const, limit: 30, cursor: 37},
            ],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=19)

<time>May 14th at 3:46pm EDT</time>\n
<message id="19" from="[Bob](/human/bob)">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 20\n\n</message>\n
<time>May 14th at 5:22pm EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<message id="22-24" from="[Alice](/human/alice)">\n\nTest message 22\n\nTest message 23\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 27\n\n</message>\n
<time>May 14th at 7:29pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>\n
<message id="29-30" from="[Bob](/human/bob)">\n\nTest message 29\n\nTest message 30\n\n</message>\n
<message id="31" from="[Alice](/human/alice)">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 34\n\n</message>\n
<time>May 14th at 9:36pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<message id="36-37" from="[Alice](/human/alice)">\n\nTest message 36\n\nTest message 37\n\n</message>\n
<message id="38" from="[Bob](/human/bob)">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 41\n\n</message>\n
<time>May 14th at 11:43pm EDT</time>\n
<message id="42" from="[Bob](/human/bob)">\n\nTest message 42\n\n</message>\n
<message id="43-44" from="[Alice](/human/alice)">\n\nTest message 43\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 48\n\n</message>\n
<time>May 15th at 1:50am EDT</time>\n
<message id="49" from="[Bob](/human/bob)">\n\nTest message 49\n\n</message>\n
<message id="50-51" from="[Alice](/human/alice)">\n\nTest message 50\n\nTest message 51\n\n</message>\n
<message id="52" from="[Bob](/human/bob)">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 55\n\n</message>\n
<time>May 15th at 3:57am EDT</time>\n
<message id="56" from="[Alice](/human/alice)">\n\nTest message 56\n\n</message>\n
<message id="57-58" from="[Bob](/human/bob)">\n\nTest message 57\n\nTest message 58\n\n</message>\n
<message id="59" from="[Alice](/human/alice)">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 62\n\n</message>\n
<time>May 15th at 6:04am EDT</time>\n
<message id="63-66" from="[Bob](/human/bob)">\n\nTest message 63\n\nTest message 64\n\nTest message 65\n\nTest message 66\n\n</message>`,
        },
    ])(
        "reads messages before a cursor with pagination when adjacent messages may merge (requests: $requestCount, limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => {
                        // Add minutes in increments of 1, 2, 4, 8, 16, 32, 64 and then loop back to 1.
                        const minutes = Math.floor(index / 7) * 127 + 2 ** (index % 7);

                        const author = stableRandomBit(index) === 0 ? aliceAccount : bobAccount;

                        return createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(Date.UTC(2026, 4, 14, 15, minutes)).toISOString(),
                        });
                    },
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?after=62",
            requestCount: 1,
            limit: "500b",
            requests: [{limit: 30, cursor: 62}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=68)

<time>May 15th at 6:04am EDT</time>\n
<message id="63-66" from="[Bob](/human/bob)">\n\nTest message 63\n\nTest message 64\n\nTest message 65\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 68\n\n</message>`,
        },
        {
            path: "/chat/incident-response?after=62",
            requestCount: 1,
            limit: "734b",
            requests: [{limit: 30, cursor: 62}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=70)

<time>May 15th at 6:04am EDT</time>\n
<message id="63-66" from="[Bob](/human/bob)">\n\nTest message 63\n\nTest message 64\n\nTest message 65\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 69\n\n</message>\n
<time>May 15th at 8:11am EDT</time>\n
<message id="70" from="[Alice](/human/alice)">\n\nTest message 70\n\n</message>`,
        },
        {
            path: "/chat/incident-response?after=62",
            requestCount: 1,
            limit: "3.45kb",
            requests: [{limit: 30, cursor: 62}],
            response: `\
# Incident Response

<time>May 15th at 6:04am EDT</time>\n
<message id="63-66" from="[Bob](/human/bob)">\n\nTest message 63\n\nTest message 64\n\nTest message 65\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 69\n\n</message>\n
<time>May 15th at 8:11am EDT</time>\n
<message id="70" from="[Alice](/human/alice)">\n\nTest message 70\n\n</message>\n
<message id="71-72" from="[Bob](/human/bob)">\n\nTest message 71\n\nTest message 72\n\n</message>\n
<message id="73" from="[Alice](/human/alice)">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 76\n\n</message>\n
<time>May 15th at 10:18am EDT</time>\n
<message id="77" from="[Bob](/human/bob)">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)">\n\nTest message 78\n\n</message>\n
<message id="79-80" from="[Bob](/human/bob)">\n\nTest message 79\n\nTest message 80\n\n</message>\n
<message id="81" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 83\n\n</message>\n
<time>May 15th at 12:25pm EDT</time>\n
<message id="84-87" from="[Alice](/human/alice)">\n\nTest message 84\n\nTest message 85\n\nTest message 86\n\nTest message 87\n\n</message>\n
<message id="88" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
    ])(
        "reads messages after a cursor with pagination when adjacent messages may merge (requests: $requestCount, limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => {
                        // Add minutes in increments of 1, 2, 4, 8, 16, 32, 64 and then loop back to 1.
                        const minutes = Math.floor(index / 7) * 127 + 2 ** (index % 7);

                        const author = stableRandomBit(index) === 0 ? aliceAccount : bobAccount;

                        return createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(Date.UTC(2026, 4, 14, 15, minutes)).toISOString(),
                        });
                    },
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=64",
            limit: "500b",
            requests: [{limit: 30, cursor: 49}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=63) | [Next page »](/chat/incident-response?after=67)

<time>May 15th at 6:04am EDT</time>\n
<message id="63-66" from="[Bob](/human/bob)">\n\nTest message 63\n\nTest message 64\n\nTest message 65\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 67\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=64",
            limit: "1kb",
            requests: [{limit: 30, cursor: 49}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=60) | [Next page »](/chat/incident-response?after=69)

<time>May 15th at 4:12am EDT</time>\n
<message id="60" from="[Alice](/human/alice)">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 62\n\n</message>\n
<time>May 15th at 6:04am EDT</time>\n
<message id="63-66" from="[Bob](/human/bob)">\n\nTest message 63\n\nTest message 64\n\nTest message 65\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 69\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=64",
            limit: "4kb",
            requests: [
                {limit: 30, cursor: 49},
                {from: "End" as const, limit: 15, cursor: 50},
                {limit: 15, cursor: 79},
            ],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=41) | [Next page »](/chat/incident-response?after=88)

<time>May 14th at 10:39pm EDT</time>\n
<message id="41" from="[Bob](/human/bob)">\n\nTest message 41\n\n</message>\n
<time>May 14th at 11:43pm EDT</time>\n
<message id="42" from="[Bob](/human/bob)">\n\nTest message 42\n\n</message>\n
<message id="43-44" from="[Alice](/human/alice)">\n\nTest message 43\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 47\n\n</message>\n
<message id="48" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 48\n\n</message>\n
<time>May 15th at 1:50am EDT</time>\n
<message id="49" from="[Bob](/human/bob)">\n\nTest message 49\n\n</message>\n
<message id="50-51" from="[Alice](/human/alice)">\n\nTest message 50\n\nTest message 51\n\n</message>\n
<message id="52" from="[Bob](/human/bob)">\n\nTest message 52\n\n</message>\n
<message id="53" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 53\n\n</message>\n
<message id="54" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 54\n\n</message>\n
<message id="55" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 55\n\n</message>\n
<time>May 15th at 3:57am EDT</time>\n
<message id="56" from="[Alice](/human/alice)">\n\nTest message 56\n\n</message>\n
<message id="57-58" from="[Bob](/human/bob)">\n\nTest message 57\n\nTest message 58\n\n</message>\n
<message id="59" from="[Alice](/human/alice)">\n\nTest message 59\n\n</message>\n
<message id="60" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 60\n\n</message>\n
<message id="61" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 61\n\n</message>\n
<message id="62" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 62\n\n</message>\n
<time>May 15th at 6:04am EDT</time>\n
<message id="63-66" from="[Bob](/human/bob)">\n\nTest message 63\n\nTest message 64\n\nTest message 65\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 69\n\n</message>\n
<time>May 15th at 8:11am EDT</time>\n
<message id="70" from="[Alice](/human/alice)">\n\nTest message 70\n\n</message>\n
<message id="71-72" from="[Bob](/human/bob)">\n\nTest message 71\n\nTest message 72\n\n</message>\n
<message id="73" from="[Alice](/human/alice)">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 76\n\n</message>\n
<time>May 15th at 10:18am EDT</time>\n
<message id="77" from="[Bob](/human/bob)">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)">\n\nTest message 78\n\n</message>\n
<message id="79-80" from="[Bob](/human/bob)">\n\nTest message 79\n\nTest message 80\n\n</message>\n
<message id="81" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 83\n\n</message>\n
<time>May 15th at 12:25pm EDT</time>\n
<message id="84-87" from="[Alice](/human/alice)">\n\nTest message 84\n\nTest message 85\n\nTest message 86\n\nTest message 87\n\n</message>\n
<message id="88" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 88\n\n</message>`,
        },
    ])(
        "reads single message in the middle of a long message list when adjacent messages may merge (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => {
                        // Add minutes in increments of 1, 2, 4, 8, 16, 32, 64 and then loop back to 1.
                        const minutes = Math.floor(index / 7) * 127 + 2 ** (index % 7);

                        const author = stableRandomBit(index) === 0 ? aliceAccount : bobAccount;

                        return createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(Date.UTC(2026, 4, 14, 15, minutes)).toISOString(),
                        });
                    },
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=10",
            limit: "500b",
            requests: [{limit: 30, cursor: -5}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=8) | [Next page »](/chat/incident-response?after=11)

<time>May 14th at 1:09pm EDT</time>\n
<message id="8" from="[Bob](/human/bob)">\n\nTest message 8\n\n</message>\n
<message id="9-10" from="[Alice](/human/alice)">\n\nTest message 9\n\nTest message 10\n\n</message>\n
<message id="11" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 11\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=10",
            limit: "1kb",
            requests: [{limit: 30, cursor: -5}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=6) | [Next page »](/chat/incident-response?after=14)

<time>May 14th at 12:04pm EDT</time>\n
<message id="6" from="[Bob](/human/bob)">\n\nTest message 6\n\n</message>\n
<time>May 14th at 1:08pm EDT</time>\n
<message id="7" from="[Alice](/human/alice)">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Bob](/human/bob)">\n\nTest message 8\n\n</message>\n
<message id="9-10" from="[Alice](/human/alice)">\n\nTest message 9\n\nTest message 10\n\n</message>\n
<message id="11" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 13\n\n</message>\n
<time>May 14th at 3:15pm EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=10",
            limit: "3.43kb",
            requests: [
                {limit: 30, cursor: -5},
                {limit: 15, cursor: 29},
            ],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=40)

<time>May 14th at 11:01am EDT</time>\n
<message id="0-2" from="[Alice](/human/alice)">\n\nTest message 0\n\nTest message 1\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 6\n\n</message>\n
<time>May 14th at 1:08pm EDT</time>\n
<message id="7" from="[Alice](/human/alice)">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Bob](/human/bob)">\n\nTest message 8\n\n</message>\n
<message id="9-10" from="[Alice](/human/alice)">\n\nTest message 9\n\nTest message 10\n\n</message>\n
<message id="11" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 13\n\n</message>\n
<time>May 14th at 3:15pm EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)">\n\nTest message 15\n\n</message>\n
<message id="16-17" from="[Alice](/human/alice)">\n\nTest message 16\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 20\n\n</message>\n
<time>May 14th at 5:22pm EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<message id="22-24" from="[Alice](/human/alice)">\n\nTest message 22\n\nTest message 23\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 27\n\n</message>\n
<time>May 14th at 7:29pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>\n
<message id="29-30" from="[Bob](/human/bob)">\n\nTest message 29\n\nTest message 30\n\n</message>\n
<message id="31" from="[Alice](/human/alice)">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 34\n\n</message>\n
<time>May 14th at 9:36pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<message id="36-37" from="[Alice](/human/alice)">\n\nTest message 36\n\nTest message 37\n\n</message>\n
<message id="38" from="[Bob](/human/bob)">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 40\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=10",
            limit: "4kb",
            requests: [
                {limit: 30, cursor: -5},
                {limit: 15, cursor: 29},
                {limit: 15, cursor: 44},
            ],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=47)

<time>May 14th at 11:01am EDT</time>\n
<message id="0-2" from="[Alice](/human/alice)">\n\nTest message 0\n\nTest message 1\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 6\n\n</message>\n
<time>May 14th at 1:08pm EDT</time>\n
<message id="7" from="[Alice](/human/alice)">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Bob](/human/bob)">\n\nTest message 8\n\n</message>\n
<message id="9-10" from="[Alice](/human/alice)">\n\nTest message 9\n\nTest message 10\n\n</message>\n
<message id="11" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 13\n\n</message>\n
<time>May 14th at 3:15pm EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)">\n\nTest message 15\n\n</message>\n
<message id="16-17" from="[Alice](/human/alice)">\n\nTest message 16\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 20\n\n</message>\n
<time>May 14th at 5:22pm EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<message id="22-24" from="[Alice](/human/alice)">\n\nTest message 22\n\nTest message 23\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 27\n\n</message>\n
<time>May 14th at 7:29pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>\n
<message id="29-30" from="[Bob](/human/bob)">\n\nTest message 29\n\nTest message 30\n\n</message>\n
<message id="31" from="[Alice](/human/alice)">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 34\n\n</message>\n
<time>May 14th at 9:36pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<message id="36-37" from="[Alice](/human/alice)">\n\nTest message 36\n\nTest message 37\n\n</message>\n
<message id="38" from="[Bob](/human/bob)">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 41\n\n</message>\n
<time>May 14th at 11:43pm EDT</time>\n
<message id="42" from="[Bob](/human/bob)">\n\nTest message 42\n\n</message>\n
<message id="43-44" from="[Alice](/human/alice)">\n\nTest message 43\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 47\n\n</message>`,
        },
    ])(
        "reads single message near the start of a long message list when adjacent messages may merge (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => {
                        // Add minutes in increments of 1, 2, 4, 8, 16, 32, 64 and then loop back to 1.
                        const minutes = Math.floor(index / 7) * 127 + 2 ** (index % 7);

                        const author = stableRandomBit(index) === 0 ? aliceAccount : bobAccount;

                        return createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(Date.UTC(2026, 4, 14, 15, minutes)).toISOString(),
                        });
                    },
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=1",
            limit: "500b",
            requests: [{limit: 30, cursor: -14}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=4)

<time>May 14th at 11:01am EDT</time>\n
<message id="0-2" from="[Alice](/human/alice)">\n\nTest message 0\n\nTest message 1\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 4\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=1",
            limit: "1kb",
            requests: [{limit: 30, cursor: -14}],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=10)

<time>May 14th at 11:01am EDT</time>\n
<message id="0-2" from="[Alice](/human/alice)">\n\nTest message 0\n\nTest message 1\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 6\n\n</message>\n
<time>May 14th at 1:08pm EDT</time>\n
<message id="7" from="[Alice](/human/alice)">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Bob](/human/bob)">\n\nTest message 8\n\n</message>\n
<message id="9-10" from="[Alice](/human/alice)">\n\nTest message 9\n\nTest message 10\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=1",
            limit: "4kb",
            requests: [
                {limit: 30, cursor: -14},
                {limit: 15, cursor: 29},
                {limit: 15, cursor: 44},
            ],
            response: `\
# Incident Response

[Next page »](/chat/incident-response?after=47)

<time>May 14th at 11:01am EDT</time>\n
<message id="0-2" from="[Alice](/human/alice)">\n\nTest message 0\n\nTest message 1\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 6\n\n</message>\n
<time>May 14th at 1:08pm EDT</time>\n
<message id="7" from="[Alice](/human/alice)">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Bob](/human/bob)">\n\nTest message 8\n\n</message>\n
<message id="9-10" from="[Alice](/human/alice)">\n\nTest message 9\n\nTest message 10\n\n</message>\n
<message id="11" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 13\n\n</message>\n
<time>May 14th at 3:15pm EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)">\n\nTest message 15\n\n</message>\n
<message id="16-17" from="[Alice](/human/alice)">\n\nTest message 16\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 20\n\n</message>\n
<time>May 14th at 5:22pm EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<message id="22-24" from="[Alice](/human/alice)">\n\nTest message 22\n\nTest message 23\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 27\n\n</message>\n
<time>May 14th at 7:29pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>\n
<message id="29-30" from="[Bob](/human/bob)">\n\nTest message 29\n\nTest message 30\n\n</message>\n
<message id="31" from="[Alice](/human/alice)">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 34\n\n</message>\n
<time>May 14th at 9:36pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<message id="36-37" from="[Alice](/human/alice)">\n\nTest message 36\n\nTest message 37\n\n</message>\n
<message id="38" from="[Bob](/human/bob)">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 39\n\n</message>\n
<message id="40" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 40\n\n</message>\n
<message id="41" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 41\n\n</message>\n
<time>May 14th at 11:43pm EDT</time>\n
<message id="42" from="[Bob](/human/bob)">\n\nTest message 42\n\n</message>\n
<message id="43-44" from="[Alice](/human/alice)">\n\nTest message 43\n\nTest message 44\n\n</message>\n
<message id="45" from="[Bob](/human/bob)">\n\nTest message 45\n\n</message>\n
<message id="46" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 46\n\n</message>\n
<message id="47" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 47\n\n</message>`,
        },
    ])(
        "reads single message at the start of a long message list when adjacent messages may merge (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => {
                        // Add minutes in increments of 1, 2, 4, 8, 16, 32, 64 and then loop back to 1.
                        const minutes = Math.floor(index / 7) * 127 + 2 ** (index % 7);

                        const author = stableRandomBit(index) === 0 ? aliceAccount : bobAccount;

                        return createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(Date.UTC(2026, 4, 14, 15, minutes)).toISOString(),
                        });
                    },
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=85",
            limit: "500b",
            requests: [{limit: 30, cursor: 70}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=84) | [Next page »](/chat/incident-response?after=88)

<time>May 15th at 12:25pm EDT</time>\n
<message id="84-87" from="[Alice](/human/alice)">\n\nTest message 84\n\nTest message 85\n\nTest message 86\n\nTest message 87\n\n</message>\n
<message id="88" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 88\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=85",
            limit: "1kb",
            requests: [{limit: 30, cursor: 70}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=79)

<time>May 15th at 10:21am EDT</time>\n
<message id="79-80" from="[Bob](/human/bob)">\n\nTest message 79\n\nTest message 80\n\n</message>\n
<message id="81" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 83\n\n</message>\n
<time>May 15th at 12:25pm EDT</time>\n
<message id="84-87" from="[Alice](/human/alice)">\n\nTest message 84\n\nTest message 85\n\nTest message 86\n\nTest message 87\n\n</message>\n
<message id="88" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=85",
            limit: "2.237kb",
            requests: [
                {limit: 30, cursor: 70},
                {from: "End" as const, limit: 15, cursor: 71},
            ],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=63)

<time>May 15th at 6:04am EDT</time>\n
<message id="63-66" from="[Bob](/human/bob)">\n\nTest message 63\n\nTest message 64\n\nTest message 65\n\nTest message 66\n\n</message>\n
<message id="67" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 67\n\n</message>\n
<message id="68" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 69\n\n</message>\n
<time>May 15th at 8:11am EDT</time>\n
<message id="70" from="[Alice](/human/alice)">\n\nTest message 70\n\n</message>\n
<message id="71-72" from="[Bob](/human/bob)">\n\nTest message 71\n\nTest message 72\n\n</message>\n
<message id="73" from="[Alice](/human/alice)">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 76\n\n</message>\n
<time>May 15th at 10:18am EDT</time>\n
<message id="77" from="[Bob](/human/bob)">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)">\n\nTest message 78\n\n</message>\n
<message id="79-80" from="[Bob](/human/bob)">\n\nTest message 79\n\nTest message 80\n\n</message>\n
<message id="81" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 83\n\n</message>\n
<time>May 15th at 12:25pm EDT</time>\n
<message id="84-87" from="[Alice](/human/alice)">\n\nTest message 84\n\nTest message 85\n\nTest message 86\n\nTest message 87\n\n</message>\n
<message id="88" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
    ])(
        "reads single message near the end of a long message list when adjacent messages may merge (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => {
                        // Add minutes in increments of 1, 2, 4, 8, 16, 32, 64 and then loop back to 1.
                        const minutes = Math.floor(index / 7) * 127 + 2 ** (index % 7);

                        const author = stableRandomBit(index) === 0 ? aliceAccount : bobAccount;

                        return createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(Date.UTC(2026, 4, 14, 15, minutes)).toISOString(),
                        });
                    },
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=86",
            limit: "500b",
            requests: [{limit: 30, cursor: 71}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=84) | [Next page »](/chat/incident-response?after=88)

<time>May 15th at 12:25pm EDT</time>\n
<message id="84-87" from="[Alice](/human/alice)">\n\nTest message 84\n\nTest message 85\n\nTest message 86\n\nTest message 87\n\n</message>\n
<message id="88" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 88\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=86",
            limit: "1kb",
            requests: [{limit: 30, cursor: 71}],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=79)

<time>May 15th at 10:21am EDT</time>\n
<message id="79-80" from="[Bob](/human/bob)">\n\nTest message 79\n\nTest message 80\n\n</message>\n
<message id="81" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 83\n\n</message>\n
<time>May 15th at 12:25pm EDT</time>\n
<message id="84-87" from="[Alice](/human/alice)">\n\nTest message 84\n\nTest message 85\n\nTest message 86\n\nTest message 87\n\n</message>\n
<message id="88" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
        {
            path: "/chat/incident-response?message=86",
            limit: "2kb",
            requests: [
                {limit: 30, cursor: 71},
                {from: "End" as const, limit: 15, cursor: 72},
            ],
            response: `\
# Incident Response

[Previous page »](/chat/incident-response?before=68)

<time>May 15th at 6:35am EDT</time>\n
<message id="68" from="[Alice](/human/alice)">\n\nTest message 68\n\n</message>\n
<message id="69" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 69\n\n</message>\n
<time>May 15th at 8:11am EDT</time>\n
<message id="70" from="[Alice](/human/alice)">\n\nTest message 70\n\n</message>\n
<message id="71-72" from="[Bob](/human/bob)">\n\nTest message 71\n\nTest message 72\n\n</message>\n
<message id="73" from="[Alice](/human/alice)">\n\nTest message 73\n\n</message>\n
<message id="74" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 74\n\n</message>\n
<message id="75" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 75\n\n</message>\n
<message id="76" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 76\n\n</message>\n
<time>May 15th at 10:18am EDT</time>\n
<message id="77" from="[Bob](/human/bob)">\n\nTest message 77\n\n</message>\n
<message id="78" from="[Alice](/human/alice)">\n\nTest message 78\n\n</message>\n
<message id="79-80" from="[Bob](/human/bob)">\n\nTest message 79\n\nTest message 80\n\n</message>\n
<message id="81" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 81\n\n</message>\n
<message id="82" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 82\n\n</message>\n
<message id="83" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 83\n\n</message>\n
<time>May 15th at 12:25pm EDT</time>\n
<message id="84-87" from="[Alice](/human/alice)">\n\nTest message 84\n\nTest message 85\n\nTest message 86\n\nTest message 87\n\n</message>\n
<message id="88" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 88\n\n</message>\n
<message id="89" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 89\n\n</message>

End of messages.`,
        },
    ])(
        "reads single message at the end of a long message list when adjacent messages may merge (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => {
                        // Add minutes in increments of 1, 2, 4, 8, 16, 32, 64 and then loop back to 1.
                        const minutes = Math.floor(index / 7) * 127 + 2 ** (index % 7);

                        const author = stableRandomBit(index) === 0 ? aliceAccount : bobAccount;

                        return createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(Date.UTC(2026, 4, 14, 15, minutes)).toISOString(),
                        });
                    },
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    test.each([
        {
            path: "/chat/incident-response?message=23",
            limit: "500b",
            requests: [{limit: 30, cursor: 8}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=21) | [Next page »](/chat/incident-response?after=25)

<time>May 14th at 5:22pm EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<message id="22-24" from="[Alice](/human/alice)">\n\nTest message 22\n\nTest message 23\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 25\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=23",
            limit: "984b",
            requests: [{limit: 30, cursor: 8}],
            response: `\
# Incident Response

[« Previous page](/chat/incident-response?before=19) | [Next page »](/chat/incident-response?after=27)

<time>May 14th at 3:46pm EDT</time>\n
<message id="19" from="[Bob](/human/bob)">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 20\n\n</message>\n
<time>May 14th at 5:22pm EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<message id="22-24" from="[Alice](/human/alice)">\n\nTest message 22\n\nTest message 23\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 27\n\n</message>`,
        },
        {
            path: "/chat/incident-response?message=23",
            limit: "5kb",
            requests: [
                {limit: 30, cursor: 8},
                {from: "End" as const, limit: 15, cursor: 9},
                {limit: 15, cursor: 38},
            ],
            response: `\
# Incident Response

<time>May 14th at 11:01am EDT</time>\n
<message id="0-2" from="[Alice](/human/alice)">\n\nTest message 0\n\nTest message 1\n\nTest message 2\n\n</message>\n
<message id="3" from="[Bob](/human/bob)">\n\nTest message 3\n\n</message>\n
<message id="4" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 4\n\n</message>\n
<message id="5" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 5\n\n</message>\n
<message id="6" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 6\n\n</message>\n
<time>May 14th at 1:08pm EDT</time>\n
<message id="7" from="[Alice](/human/alice)">\n\nTest message 7\n\n</message>\n
<message id="8" from="[Bob](/human/bob)">\n\nTest message 8\n\n</message>\n
<message id="9-10" from="[Alice](/human/alice)">\n\nTest message 9\n\nTest message 10\n\n</message>\n
<message id="11" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 11\n\n</message>\n
<message id="12" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 12\n\n</message>\n
<message id="13" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 13\n\n</message>\n
<time>May 14th at 3:15pm EDT</time>\n
<message id="14" from="[Alice](/human/alice)">\n\nTest message 14\n\n</message>\n
<message id="15" from="[Bob](/human/bob)">\n\nTest message 15\n\n</message>\n
<message id="16-17" from="[Alice](/human/alice)">\n\nTest message 16\n\nTest message 17\n\n</message>\n
<message id="18" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 18\n\n</message>\n
<message id="19" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 19\n\n</message>\n
<message id="20" from="[Bob](/human/bob)" time="32 minutes later">\n\nTest message 20\n\n</message>\n
<time>May 14th at 5:22pm EDT</time>\n
<message id="21" from="[Bob](/human/bob)">\n\nTest message 21\n\n</message>\n
<message id="22-24" from="[Alice](/human/alice)">\n\nTest message 22\n\nTest message 23\n\nTest message 24\n\n</message>\n
<message id="25" from="[Bob](/human/bob)" time="8 minutes later">\n\nTest message 25\n\n</message>\n
<message id="26" from="[Bob](/human/bob)" time="16 minutes later">\n\nTest message 26\n\n</message>\n
<message id="27" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 27\n\n</message>\n
<time>May 14th at 7:29pm EDT</time>\n
<message id="28" from="[Alice](/human/alice)">\n\nTest message 28\n\n</message>\n
<message id="29-30" from="[Bob](/human/bob)">\n\nTest message 29\n\nTest message 30\n\n</message>\n
<message id="31" from="[Alice](/human/alice)">\n\nTest message 31\n\n</message>\n
<message id="32" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 32\n\n</message>\n
<message id="33" from="[Alice](/human/alice)" time="16 minutes later">\n\nTest message 33\n\n</message>\n
<message id="34" from="[Alice](/human/alice)" time="32 minutes later">\n\nTest message 34\n\n</message>\n
<time>May 14th at 9:36pm EDT</time>\n
<message id="35" from="[Bob](/human/bob)">\n\nTest message 35\n\n</message>\n
<message id="36-37" from="[Alice](/human/alice)">\n\nTest message 36\n\nTest message 37\n\n</message>\n
<message id="38" from="[Bob](/human/bob)">\n\nTest message 38\n\n</message>\n
<message id="39" from="[Alice](/human/alice)" time="8 minutes later">\n\nTest message 39\n\n</message>

End of messages.`,
        },
    ])(
        "reads single message in a small message list when adjacent messages may merge (limit: $limit)",
        async ({path, limit, requests, response}) => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 40,
                    ...request,
                    createMessage: index => {
                        // Add minutes in increments of 1, 2, 4, 8, 16, 32, 64 and then loop back to 1.
                        const minutes = Math.floor(index / 7) * 127 + 2 ** (index % 7);

                        const author = stableRandomBit(index) === 0 ? aliceAccount : bobAccount;

                        return createApiMessageMock({
                            index,
                            author,
                            createdTime: new Date(Date.UTC(2026, 4, 14, 15, minutes)).toISOString(),
                        });
                    },
                });
            }

            expect(
                await callAgentWebReadTool(context, {
                    path,
                    limit,
                }),
            ).toEqual(response);
        },
    );

    describe("ranged pagination", () => {
        test.each([
            {
                name: "from start",
                path: "/chat/incident-response?after=9&before=15&from=start",
                requests: [{limit: 5, cursor: 9}],
                expectedMessageIndexes: [10, 11, 12, 13, 14],
                isEndOfMessages: false,
            },
            {
                name: "from end",
                path: "/chat/incident-response?after=9&before=15&from=end",
                requests: [{from: "End" as const, limit: 5, cursor: 15}],
                expectedMessageIndexes: [10, 11, 12, 13, 14],
                isEndOfMessages: false,
            },
            {
                name: "ending exactly at an API batch boundary",
                path: "/chat/incident-response?after=9&before=40&from=start",
                requests: [{limit: 30, cursor: 9}],
                expectedMessageIndexes: Array.from({length: 30}, (_, index) => index + 10),
                isEndOfMessages: false,
            },
            {
                name: "extending before the start of the room",
                path: "/chat/incident-response?after=-10&before=5&from=start",
                requests: [{limit: 5, cursor: -10}],
                expectedMessageIndexes: [0, 1, 2, 3, 4],
                isEndOfMessages: false,
            },
            {
                name: "extending after the end of the room",
                path: "/chat/incident-response?after=85&before=100&from=end",
                requests: [{from: "End" as const, limit: 14, cursor: 100}],
                expectedMessageIndexes: [86, 87, 88, 89],
                isEndOfMessages: true,
            },
        ])("reads only messages in a complete range $name", async options => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of options.requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            const response = await callAgentWebReadTool(context, {
                path: options.path,
                limit: "20kb",
            });

            expect({
                messageIndexes: Array.from(response.matchAll(/<message id="(-?[0-9]+)"/g), match =>
                    Number(match[1]),
                ),
                hasPagination: response.includes("Previous page") || response.includes("Next page"),
                isEndOfMessages: response.endsWith("End of messages."),
            }).toEqual({
                messageIndexes: options.expectedMessageIndexes,
                hasPagination: false,
                isEndOfMessages: options.isEndOfMessages,
            });
        });

        test.each([
            {
                name: "two requests from start",
                path: "/chat/incident-response?after=9&before=45&from=start",
                requests: [
                    {limit: 30, cursor: 9},
                    {limit: 5, cursor: 39},
                ],
                expectedStartIndex: 10,
                expectedMessageCount: 35,
            },
            {
                name: "two requests from end",
                path: "/chat/incident-response?after=39&before=75&from=end",
                requests: [
                    {from: "End" as const, limit: 30, cursor: 75},
                    {from: "End" as const, limit: 5, cursor: 45},
                ],
                expectedStartIndex: 40,
                expectedMessageCount: 35,
            },
            {
                name: "three requests from start",
                path: "/chat/incident-response?after=0&before=89&from=start",
                requests: [
                    {limit: 30, cursor: 0},
                    {limit: 30, cursor: 30},
                    {limit: 28, cursor: 60},
                ],
                expectedStartIndex: 1,
                expectedMessageCount: 88,
            },
        ])("fills a complete range with $name", async options => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});

            for (const request of options.requests) {
                mockApiGetChatMessages(api, {
                    spaceId,
                    chatId,
                    totalMessageCount: 90,
                    ...request,
                    createMessage: index => createApiMessageMock({index, author}),
                });
            }

            const response = await callAgentWebReadTool(context, {
                path: options.path,
                limit: "20kb",
            });
            const messageIndexes = Array.from(
                response.matchAll(/<message id="(-?[0-9]+)"/g),
                match => Number(match[1]),
            );

            expect({
                messageIndexes,
                hasPagination: response.includes("Previous page") || response.includes("Next page"),
                isEndOfMessages: response.endsWith("End of messages."),
            }).toEqual({
                messageIndexes: Array.from(
                    {length: options.expectedMessageCount},
                    (_, index) => options.expectedStartIndex + index,
                ),
                hasPagination: false,
                isEndOfMessages: false,
            });
        });

        test.each([
            {
                name: "from start",
                path: "/chat/incident-response?after=9&before=80&from=start",
                request: {limit: 30, cursor: 9},
                paginationPattern: /\?after=[0-9]+\)/,
            },
            {
                name: "from end",
                path: "/chat/incident-response?after=9&before=80&from=end",
                request: {from: "End" as const, limit: 30, cursor: 80},
                paginationPattern: /\?before=[0-9]+\)/,
            },
            {
                name: "from start after loading the full range",
                path: "/chat/incident-response?after=9&before=30&from=start",
                request: {limit: 20, cursor: 9},
                paginationPattern: /\?after=[0-9]+\)/,
            },
            {
                name: "from end after loading the full range",
                path: "/chat/incident-response?after=59&before=80&from=end",
                request: {from: "End" as const, limit: 20, cursor: 80},
                paginationPattern: /\?before=[0-9]+\)/,
            },
        ])("paginates naturally when the tool limit truncates $name", async options => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
            mockApiGetChatMessages(api, {
                spaceId,
                chatId,
                totalMessageCount: 90,
                ...options.request,
                createMessage: index => createApiMessageMock({index, author}),
            });

            const response = await callAgentWebReadTool(context, {
                path: options.path,
                limit: "500b",
            });

            expect(response).toMatch(options.paginationPattern);
        });

        test.each([
            {
                name: "equal endpoints from start",
                path: "/chat/incident-response?after=20&before=20&from=start",
            },
            {
                name: "reversed endpoints from start",
                path: "/chat/incident-response?after=20&before=10&from=start",
            },
            {
                name: "reversed endpoints from end",
                path: "/chat/incident-response?after=20&before=10&from=end",
            },
        ])("returns an error for $name", async options => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
            expect(
                await callAgentWebReadTool(context, {
                    path: options.path,
                    limit: "10kb",
                }),
            ).toEqual(
                `Error: Couldn\u2019t read \`${options.path}\`. Expected the \`?before\` URL search param to be after the \`?after\` URL search param. Try again and flip the values in \`?before\` and \`?after\` (and make sure they have different values).`,
            );
        });

        test.each([
            {
                name: "after with from=start",
                path: "/chat/incident-response?after=9&from=start",
                request: {limit: 30, cursor: 9},
            },
            {
                name: "before with from=end",
                path: "/chat/incident-response?before=80&from=end",
                request: {from: "End" as const, limit: 30, cursor: 80},
            },
        ])("allows $name", async options => {
            mockApiGetChat(api, {spaceId, chatId, name: "Incident Response"});
            mockApiGetChatMessages(api, {
                spaceId,
                chatId,
                totalMessageCount: 90,
                ...options.request,
                createMessage: index => createApiMessageMock({index, author}),
            });

            expect(
                await callAgentWebReadTool(context, {
                    path: options.path,
                    limit: "500b",
                }),
            ).toContain("<message");
        });
    });
});
