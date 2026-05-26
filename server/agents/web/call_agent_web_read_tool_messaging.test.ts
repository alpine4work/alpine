import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {printAgentWebPageLinkPathname} from "~/server/agents/web/agent_web_page_link.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebScrollTool} from "~/server/agents/web/call_agent_web_scroll_tool.js";
import {
    AgentWebMessagingPageBase,
    agentWebMessagingPageMessageNouns,
    readAgentWebMessagingPageBaseAroundMessage,
} from "~/server/agents/web/pages/agent_web_messaging_page_base.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {
    ApiAccount,
    ApiContentResponse,
    ApiMessageContentPayloadParentContentSnippet,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InternalError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assertDateString} from "~/shared/helpers/date/date_string.js";
import {TimeZone, assertTimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {BotId, ChatId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_read_tool_messaging.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);
const context: AgentWebContext = {spaceId, api, storage, span, timeZone: defaultTimeZone};

const currentTime = new Date("2026-05-19T12:00:00.000Z");
const aliceAccount = createApiAccountMock({name: "Alice"});
const bobAccount = createApiAccountMock({name: "Bob"});
const assistantAccount = createApiAccountMock({
    name: "Assistant",
    botId: generateId<BotId>(),
});

beforeEach(() => {
    import.meta.jest.useFakeTimers();
    import.meta.jest.setSystemTime(currentTime);
});

afterEach(() => {
    import.meta.jest.useRealTimers();
});

function createSampleContent(...texts: ReadonlyArray<string>): ApiContentResponse {
    return {
        elements: texts.map(text => ({
            type: "Paragraph",
            elements: [{type: "Text", text}],
        })),
    };
}

function createMarkdownContent(markdown: string): ApiContentResponse {
    return parseApiContentFromMarkdown(markdown, {spaceId}) as ApiContentResponse;
}

function createParentSnippet(
    text: string,
    {isTruncated = false}: {isTruncated?: boolean} = {},
): ApiMessageContentPayloadParentContentSnippet {
    return {
        elements: [{type: "Text", text}],
        isTruncated,
    };
}

function createMessage({
    index,
    author,
    createdTime,
    content,
    createdTimeZone = defaultTimeZone,
    parent,
}: {
    index: number;
    author: ApiAccount;
    createdTime: string;
    content: ApiContentResponse | string;
    createdTimeZone?: TimeZone;
    parent?: {
        author: ApiAccount;
        index: number;
        endIndex?: number;
        contentSnippet: ApiMessageContentPayloadParentContentSnippet;
    };
}): ApiMessageResponse {
    return {
        index,
        author,
        createdTime: assertDateString(createdTime),
        createdTimeZone,
        payload: {
            type: "Content",
            content: typeof content === "string" ? createSampleContent(content) : content,
            ...(parent
                ? {
                      parent: {
                          type: "Message" as const,
                          index: parent.index,
                          ...(parent.endIndex !== undefined ? {endIndex: parent.endIndex} : {}),
                          author: parent.author,
                          contentSnippet: parent.contentSnippet,
                      },
                  }
                : {}),
        },
    };
}

function createDeletedMessage({
    index,
    author,
    createdTime,
    createdTimeZone = defaultTimeZone,
}: {
    index: number;
    author: ApiAccount;
    createdTime: string;
    createdTimeZone?: TimeZone;
}): ApiMessageResponse {
    return {
        index,
        author,
        createdTime: assertDateString(createdTime),
        createdTimeZone,
        payload: {type: "Deleted"},
    };
}

async function seedChatPath(chatId: ChatId, title: string): Promise<string> {
    const pageLink = {type: "Chat" as const, id: chatId, title};
    const pathname = printAgentWebPageLinkPathname(pageLink, 1);
    await context.storage.pageLinkByPathname.put(pathname, pageLink);
    return pathname;
}

async function seedChatMessagePath({
    chatId,
    index,
    authorShortName,
    bodySnippet,
}: {
    chatId: ChatId;
    index: number;
    authorShortName: string;
    bodySnippet: string;
}): Promise<string> {
    const pageLink = {
        type: "ChatMessage" as const,
        id: chatId,
        index,
        authorShortName,
        bodySnippet,
    };
    const pathname = printAgentWebPageLinkPathname(pageLink, 1);
    await context.storage.pageLinkByPathname.put(pathname, pageLink);
    return pathname;
}

function mockGetDirectChat(chatId: ChatId, title: string): void {
    api.mockGet(
        "/chats/{id}",
        {
            data: {
                spaceId,
                chat: {
                    type: "Direct",
                    id: chatId,
                    title,
                    members: [{account: aliceAccount}, {account: bobAccount}],
                },
            },
        },
        {path: {id: chatId}},
    );
}

function mockGetRoomChat(chatId: ChatId, name: string): void {
    api.mockGet(
        "/chats/{id}",
        {
            data: {
                spaceId,
                chat: {
                    type: "Room",
                    id: chatId,
                    name,
                },
            },
        },
        {path: {id: chatId}},
    );
}

function mockGetRoomChatTimes(chatId: ChatId, name: string, count: number): void {
    for (let index = 0; index < count; index++) {
        mockGetRoomChat(chatId, name);
    }
}

function mockGetChatMessagesList(
    chatId: ChatId,
    messages: ReadonlyArray<ApiMessageResponse>,
    {nextCursor = null}: {nextCursor?: number | null} = {},
): void {
    api.mockGetChatMessagesList(spaceId, chatId, {
        totalMessageCount: messages.length,
        nextCursor,
        messages: [...messages],
    });
}

function mockGetChatMessagesListPage(
    chatId: ChatId,
    messages: ReadonlyArray<ApiMessageResponse>,
    {
        cursor,
        direction = "Start",
        limit = 30,
        nextCursor = null,
        totalMessageCount = messages.length,
    }: {
        cursor: number | undefined;
        direction?: "Start" | "End";
        limit?: number;
        nextCursor?: number | null;
        totalMessageCount?: number;
    },
): void {
    api.mockGet(
        "/chats/{id}/messages",
        {
            data: {
                spaceId,
                totalMessageCount,
                nextCursor,
                messages: [...messages],
            },
        },
        {
            path: {id: chatId},
            query: {
                limit,
                cursor,
                ...(direction === "End" ? {from: "End" as const} : {}),
            },
        },
    );
}

function createPaginationMessage(index: number, content = `Message ${index}`): ApiMessageResponse {
    return createMessage({
        index,
        author: index % 2 === 0 ? aliceAccount : bobAccount,
        createdTime: new Date(Date.UTC(2026, 4, 14, 15, index * 5)).toISOString(),
        content,
    });
}

function createPaginationMessageRange(
    startIndex: number,
    endIndex: number,
): ReadonlyArray<ApiMessageResponse> {
    return Array.from({length: endIndex - startIndex + 1}, (_, offset) =>
        createPaginationMessage(startIndex + offset),
    );
}

function createVerbosePaginationMessage(index: number): ApiMessageResponse {
    return createPaginationMessage(index, `Message ${index} ${"x".repeat(120)}`);
}

function createVerbosePaginationMessageRange(
    startIndex: number,
    endIndex: number,
): ReadonlyArray<ApiMessageResponse> {
    return Array.from({length: endIndex - startIndex + 1}, (_, offset) =>
        createVerbosePaginationMessage(startIndex + offset),
    );
}

function createPaginationMessageIndexRange(
    startIndex: number,
    endIndex: number,
): ReadonlyArray<number> {
    return Array.from({length: endIndex - startIndex + 1}, (_, offset) => startIndex + offset);
}

async function readChatMessageForTest({
    chatId,
    aroundMessageIndex,
    limit = "10kb",
}: {
    chatId: ChatId;
    aroundMessageIndex: number;
    limit?: string;
}): Promise<string> {
    const chatMessagePath = await seedChatMessagePath({
        chatId,
        index: aroundMessageIndex,
        authorShortName: aroundMessageIndex % 2 === 0 ? "Alice" : "Bob",
        bodySnippet: `Message ${aroundMessageIndex}`,
    });

    mockGetRoomChat(chatId, "Engineering Room");

    return callAgentWebReadTool(context, {
        path: chatMessagePath,
        limit,
    });
}

function getPaginationMessageIndexes(response: string): ReadonlyArray<number> {
    return Array.from(response.matchAll(/^Message ([0-9]+)(?:\s|$)/gm), match =>
        parseInt(match[1]!, 10),
    );
}

function getMessagingPageMessageIndexes(page: AgentWebMessagingPageBase): ReadonlyArray<number> {
    return page.blocks.flatMap(block =>
        block.type !== "Message" || !block.idAttribute
            ? []
            : createArrayWithLength(
                  block.idAttribute.endMessageIndex - block.idAttribute.startMessageIndex,
                  index => block.idAttribute!.startMessageIndex + index,
              ),
    );
}

function getChatMessagesListRequestParams(): ReadonlyArray<unknown> {
    return api
        .getRequestHistory()
        .filter(request => request.path === "/chats/{id}/messages")
        .map(request => request.params);
}

function getChatMessagesListRequestParamsForChat(chatId: ChatId): ReadonlyArray<unknown> {
    return api
        .getRequestHistory()
        .filter(
            request => request.path === "/chats/{id}/messages" && request.params.path.id === chatId,
        )
        .map(request => request.params);
}

function readNextPagePath(response: string): string {
    const match = /\[Next page »]\(([^)]+)\)/.exec(response);
    if (!match) throw new InternalError("Expected response to include a next page link");
    return match[1]!;
}

test("reads a direct chat with one human message", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Alice");

    mockGetDirectChat(chatId, "Alice");
    mockGetChatMessagesList(chatId, [
        createMessage({
            index: 0,
            author: aliceAccount,
            createdTime: "2026-05-14T15:00:00.000Z",
            content: "Hello world!",
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toEqual(`\
Some messages in a chat with Alice.

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Hello world!

</message>

End of messages.`);
});

test("reads a room chat with multiple human participants", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChat(chatId, "Engineering Room");
    mockGetChatMessagesList(chatId, [
        createMessage({
            index: 0,
            author: aliceAccount,
            createdTime: "2026-05-14T15:00:00.000Z",
            content: "Hello!",
        }),
        createMessage({
            index: 1,
            author: bobAccount,
            createdTime: "2026-05-14T15:06:00.000Z",
            content: "Hello hello!",
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toEqual(`\
Some messages in Engineering Room.

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Hello!

</message>

<message id="1" from="[Bob](/human/bob)">

Hello hello!

</message>

End of messages.`);
});

test("groups consecutive messages from the same author within 10 minutes", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChat(chatId, "Engineering Room");
    mockGetChatMessagesList(chatId, [
        createMessage({
            index: 0,
            author: aliceAccount,
            createdTime: "2026-05-14T15:00:00.000Z",
            content: "First message",
        }),
        createMessage({
            index: 1,
            author: aliceAccount,
            createdTime: "2026-05-14T15:05:00.000Z",
            content: "Second message",
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toEqual(`\
Some messages in Engineering Room.

<time>May 14th at 11:00am EDT</time>

<message id="0-1" from="[Alice](/human/alice)">

First message

Second message

</message>

End of messages.`);
});

test("separates messages from the same author after 10 minutes with a relative time", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChat(chatId, "Engineering Room");
    mockGetChatMessagesList(chatId, [
        createMessage({
            index: 0,
            author: aliceAccount,
            createdTime: "2026-05-14T15:00:00.000Z",
            content: "First message",
        }),
        createMessage({
            index: 1,
            author: aliceAccount,
            createdTime: "2026-05-14T15:30:00.000Z",
            content: "Second message",
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toEqual(`\
Some messages in Engineering Room.

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

First message

</message>

<message id="1" from="[Alice](/human/alice)" time="30 minutes later">

Second message

</message>

End of messages.`);
});

test("injects a new time block when messages are at least an hour apart", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChat(chatId, "Engineering Room");
    mockGetChatMessagesList(chatId, [
        createMessage({
            index: 0,
            author: aliceAccount,
            createdTime: "2026-05-14T15:00:00.000Z",
            content: "Morning message",
        }),
        createMessage({
            index: 1,
            author: aliceAccount,
            createdTime: "2026-05-14T16:00:00.000Z",
            content: "Noon message",
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toEqual(`\
Some messages in Engineering Room.

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Morning message

</message>

<time>May 14th at 12:00pm EDT</time>

<message id="1" from="[Alice](/human/alice)">

Noon message

</message>

End of messages.`);
});

test("prints bot messages with bot tags", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Agent Chat");

    mockGetDirectChat(chatId, "Agent Chat");
    mockGetChatMessagesList(chatId, [
        createMessage({
            index: 0,
            author: assistantAccount,
            createdTime: "2026-05-14T15:00:00.000Z",
            content: "Hello human!",
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toEqual(`\
Some messages in a chat with Agent Chat.

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Assistant](/bot/assistant)">

Hello human!

</message>

End of messages.`);
});

test("escapes author names in message tags", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Escaping Room");
    const apostrophe = String.fromCharCode(39);
    const doubleQuote = String.fromCharCode(34);
    const author = createApiAccountMock({
        name: `Alice & Bob${apostrophe}s ${doubleQuote}Bot${doubleQuote}`,
        botId: generateId<BotId>(),
    });

    mockGetRoomChat(chatId, "Escaping Room");
    mockGetChatMessagesList(chatId, [
        createMessage({
            index: 0,
            author,
            createdTime: "2026-05-14T15:00:00.000Z",
            content: "Hello",
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toEqual(`\
Some messages in Escaping Room.

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/bot/alice-and-bob-s-bot)">

Hello

</message>

End of messages.`);
});

test("prints rich message content using agent web markdown links", async () => {
    const chatId = generateId<ChatId>();
    const documentId = generateId<DocumentId>();
    const path = await seedChatPath(chatId, "Engineering Room");
    const content: ApiContentResponse = {
        elements: [
            {
                type: "Paragraph",
                elements: [
                    {type: "Text", text: "Review "},
                    {type: "Text", text: "carefully", marks: [{type: "Bold"}]},
                    {type: "Text", text: " in "},
                    {
                        type: "Mention",
                        target: {type: "Document", id: documentId, title: "Release Plan"},
                    },
                    {type: "Text", text: " before running "},
                    {type: "Text", text: "deploy", marks: [{type: "Code"}]},
                    {type: "Text", text: "."},
                ],
            },
        ],
    };

    mockGetRoomChat(chatId, "Engineering Room");
    mockGetChatMessagesList(chatId, [
        createMessage({
            index: 0,
            author: aliceAccount,
            createdTime: "2026-05-14T15:00:00.000Z",
            content,
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toEqual(`\
Some messages in Engineering Room.

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Review **carefully** in [Release Plan](/document/release-plan) before running \`deploy\`.

</message>

End of messages.`);
});

test("prints timezone attributes when human message timezones differ from context", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChat(chatId, "Engineering Room");
    mockGetChatMessagesList(chatId, [
        createMessage({
            index: 0,
            author: aliceAccount,
            createdTime: "2026-05-14T15:00:00.000Z",
            createdTimeZone: assertTimeZone("America/Los_Angeles"),
            content: "Hello from the west coast.",
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toEqual(`\
Some messages in Engineering Room.

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)" timezone="PDT">

Hello from the west coast.

</message>

End of messages.`);
});

test("omits timezone attributes for bot messages", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Agent Chat");

    mockGetDirectChat(chatId, "Agent Chat");
    mockGetChatMessagesList(chatId, [
        createMessage({
            index: 0,
            author: assistantAccount,
            createdTime: "2026-05-14T15:00:00.000Z",
            createdTimeZone: assertTimeZone("America/Los_Angeles"),
            content: "I keep bot messages timezone-free.",
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toEqual(`\
Some messages in a chat with Agent Chat.

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Assistant](/bot/assistant)">

I keep bot messages timezone-free.

</message>

End of messages.`);
});

test("prints reply previews in blockquotes", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChat(chatId, "Engineering Room");
    mockGetChatMessagesList(chatId, [
        createMessage({
            index: 0,
            author: bobAccount,
            createdTime: "2026-05-14T15:05:00.000Z",
            parent: {
                author: aliceAccount,
                index: 4,
                endIndex: 7,
                contentSnippet: createParentSnippet("Can you review the rollout?"),
            },
            content: "Taking a look now.",
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toEqual(`\
Some messages in Engineering Room.

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
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChat(chatId, "Engineering Room");
    mockGetChatMessagesList(chatId, [
        createMessage({
            index: 0,
            author: bobAccount,
            createdTime: "2026-05-14T15:05:00.000Z",
            parent: {
                author: aliceAccount,
                index: 0,
                contentSnippet: createParentSnippet("Can you review", {isTruncated: true}),
            },
            content: "Taking a look now.",
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toEqual(`\
Some messages in Engineering Room.

<time>May 14th at 11:05am EDT</time>

<message id="0" from="[Bob](/human/bob)">

<blockquote cite="?message=0">

[Alice](/human/alice): Can you review \\[\u2026]

</blockquote>

Taking a look now.

</message>

End of messages.`);
});

test("prints deleted messages", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChat(chatId, "Engineering Room");
    mockGetChatMessagesList(chatId, [
        createDeletedMessage({
            index: 0,
            author: aliceAccount,
            createdTime: "2026-05-14T15:00:00.000Z",
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toEqual(`\
Some messages in Engineering Room.

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Deleted message

</message>

End of messages.`);
});

test("reads older messages with the before search parameter", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChat(chatId, "Engineering Room");
    mockGetChatMessagesList(
        chatId,
        [
            createMessage({
                index: 4,
                author: aliceAccount,
                createdTime: "2026-05-14T14:50:00.000Z",
                content: "Older context",
            }),
            createMessage({
                index: 5,
                author: bobAccount,
                createdTime: "2026-05-14T14:55:00.000Z",
                content: "Still relevant",
            }),
        ],
        {
            nextCursor: null,
        },
    );

    await expect(
        callAgentWebReadTool(context, {
            path: `${path}?before=7`,
            limit: "10kb",
        }),
    ).resolves.toEqual(`\
Some messages in Engineering Room.

<time>May 14th at 10:50am EDT</time>

<message id="4" from="[Alice](/human/alice)">

Older context

</message>

<message id="5" from="[Bob](/human/bob)">

Still relevant

</message>`);

    expect(api.getRequestHistory()).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                method: "GET",
                path: "/chats/{id}/messages",
                params: {
                    path: {id: chatId},
                    query: {limit: 30, cursor: 7, from: "End"},
                },
            }),
        ]),
    );
});

test("reads newer messages with the after search parameter", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChat(chatId, "Engineering Room");
    mockGetChatMessagesList(
        chatId,
        [
            createMessage({
                index: 3,
                author: aliceAccount,
                createdTime: "2026-05-14T15:20:00.000Z",
                content: "Newer context",
            }),
            createMessage({
                index: 4,
                author: bobAccount,
                createdTime: "2026-05-14T15:25:00.000Z",
                content: "Latest reply",
            }),
        ],
        {
            nextCursor: null,
        },
    );

    await expect(
        callAgentWebReadTool(context, {
            path: `${path}?after=2`,
            limit: "10kb",
        }),
    ).resolves.toEqual(`\
Some messages in Engineering Room.

<time>May 14th at 11:20am EDT</time>

<message id="3" from="[Alice](/human/alice)">

Newer context

</message>

<message id="4" from="[Bob](/human/bob)">

Latest reply

</message>

End of messages.`);

    expect(api.getRequestHistory()).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                method: "GET",
                path: "/chats/{id}/messages",
                params: {
                    path: {id: chatId},
                    query: {limit: 30, cursor: 2},
                },
            }),
        ]),
    );
});

test("reads messages with the start and end search parameters", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChatTimes(chatId, "Engineering Room", 2);
    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(0, 1), {
        cursor: undefined,
        totalMessageCount: 4,
    });
    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(2, 3), {
        cursor: undefined,
        direction: "End",
        totalMessageCount: 4,
    });

    const startResponse = await callAgentWebReadTool(context, {
        path: `${path}?start`,
        limit: "10kb",
    });
    const endResponse = await callAgentWebReadTool(context, {
        path: `${path}?end`,
        limit: "10kb",
    });

    expect({
        startMessages: getPaginationMessageIndexes(startResponse),
        endMessages: getPaginationMessageIndexes(endResponse),
        requests: getChatMessagesListRequestParamsForChat(chatId),
    }).toEqual({
        startMessages: [0, 1],
        endMessages: [2, 3],
        requests: [
            {
                path: {id: chatId},
                query: {limit: 30, cursor: undefined},
            },
            {
                path: {id: chatId},
                query: {limit: 30, cursor: undefined, from: "End"},
            },
        ],
    });
});

test("throws on invalid pagination search parameters", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");
    const cases = [
        {
            query: "before=abc",
            error: "Expected `before` search param to be a positive integer",
        },
        {
            query: "before",
            error: "Expected `before` search param to be a positive integer",
        },
        {
            query: "after=-1",
            error: "Expected `after` search param to be a positive integer",
        },
        {
            query: "after=01",
            error: "Expected `after` search param to be a positive integer",
        },
        {
            query: "message=abc",
            error: "Expected `message` search param to be a positive integer or range",
        },
        {
            query: "message=7-4",
            error: "Expected `message` search param to be a positive integer or range",
        },
        {
            query: "start=0",
            error: "Expected `start` search param to be empty",
        },
        {
            query: "end=0",
            error: "Expected `end` search param to be empty",
        },
        {
            query: "before=3&after=4",
            error: "Expected only one pagination search param",
        },
        {
            query: "start&end",
            error: "Expected only one pagination search param",
        },
    ] as const;

    for (const {query, error} of cases) {
        mockGetRoomChat(chatId, "Engineering Room");
        await expect(
            callAgentWebReadTool(context, {path: `${path}?${query}`, limit: "10kb"}),
        ).rejects.toThrow(error);
    }
});

test("paginates through five chat pages from newest to oldest", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChatTimes(chatId, "Engineering Room", 5);
    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(0, 9), {
        cursor: undefined,
        direction: "End",
        totalMessageCount: 10,
    });
    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(0, 7), {
        cursor: 8,
        direction: "End",
        totalMessageCount: 10,
    });
    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(0, 5), {
        cursor: 6,
        direction: "End",
        totalMessageCount: 10,
    });
    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(0, 3), {
        cursor: 4,
        direction: "End",
        totalMessageCount: 10,
    });
    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(0, 1), {
        cursor: 2,
        direction: "End",
        nextCursor: null,
        totalMessageCount: 10,
    });

    const responses = [
        await callAgentWebReadTool(context, {path, limit: "280b"}),
        await callAgentWebReadTool(context, {path: `${path}?before=8`, limit: "280b"}),
        await callAgentWebReadTool(context, {path: `${path}?before=6`, limit: "280b"}),
        await callAgentWebReadTool(context, {path: `${path}?before=4`, limit: "280b"}),
        await callAgentWebReadTool(context, {path: `${path}?before=2`, limit: "280b"}),
    ];

    expect(responses).toEqual([
        `\
Some messages in Engineering Room. [Previous page »](/chat/engineering-room?before=8)

<time>May 14th at 11:40am EDT</time>

<message id="8" from="[Alice](/human/alice)">

Message 8

</message>

<message id="9" from="[Bob](/human/bob)">

Message 9

</message>

End of messages.`,
        `\
Some messages in Engineering Room. [Previous page »](/chat/engineering-room?before=6)

<time>May 14th at 11:30am EDT</time>

<message id="6" from="[Alice](/human/alice)">

Message 6

</message>

<message id="7" from="[Bob](/human/bob)">

Message 7

</message>`,
        `\
Some messages in Engineering Room. [Previous page »](/chat/engineering-room?before=4)

<time>May 14th at 11:20am EDT</time>

<message id="4" from="[Alice](/human/alice)">

Message 4

</message>

<message id="5" from="[Bob](/human/bob)">

Message 5

</message>`,
        `\
Some messages in Engineering Room. [Previous page »](/chat/engineering-room?before=2)

<time>May 14th at 11:10am EDT</time>

<message id="2" from="[Alice](/human/alice)">

Message 2

</message>

<message id="3" from="[Bob](/human/bob)">

Message 3

</message>`,
        `\
Some messages in Engineering Room.

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

Message 0

</message>

<message id="1" from="[Bob](/human/bob)">

Message 1

</message>`,
    ]);
});

test("loads the initial around-message window with one fewer message before than after", async () => {
    const chatId = generateId<ChatId>();

    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(0, 29), {
        cursor: -1,
        limit: 30,
        totalMessageCount: 30,
    });
    mockGetChatMessagesListPage(chatId, [], {
        cursor: 0,
        direction: "End",
        limit: 15,
        totalMessageCount: 30,
    });
    mockGetChatMessagesListPage(chatId, [], {
        cursor: 29,
        limit: 15,
        totalMessageCount: 30,
    });

    const response = await readChatMessageForTest({
        chatId,
        aroundMessageIndex: 14,
    });

    expect({
        messages: getPaginationMessageIndexes(response),
        requests: getChatMessagesListRequestParams(),
    }).toEqual({
        messages: createPaginationMessageIndexRange(0, 29),
        requests: [
            {
                path: {id: chatId},
                query: {limit: 30, cursor: -1},
            },
            {
                path: {id: chatId},
                query: {limit: 15, cursor: 0, from: "End"},
            },
            {
                path: {id: chatId},
                query: {limit: 15, cursor: 29},
            },
        ],
    });
});

test("loads a centered direct message range with different limits", async () => {
    async function readRange(limitLength: number) {
        const chatId = generateId<ChatId>();

        mockGetChatMessagesListPage(chatId, createPaginationMessageRange(85, 114), {
            cursor: 84,
            limit: 30,
            totalMessageCount: 200,
        });
        mockGetChatMessagesListPage(chatId, createPaginationMessageRange(70, 84), {
            cursor: 85,
            direction: "End",
            limit: 15,
            nextCursor: 70,
            totalMessageCount: 200,
        });
        mockGetChatMessagesListPage(chatId, createPaginationMessageRange(115, 129), {
            cursor: 114,
            limit: 15,
            nextCursor: 129,
            totalMessageCount: 200,
        });

        if (limitLength > 315) {
            mockGetChatMessagesListPage(chatId, createPaginationMessageRange(55, 69), {
                cursor: 70,
                direction: "End",
                limit: 15,
                nextCursor: 55,
                totalMessageCount: 200,
            });
            mockGetChatMessagesListPage(chatId, createPaginationMessageRange(130, 144), {
                cursor: 129,
                limit: 15,
                nextCursor: 144,
                totalMessageCount: 200,
            });
        }

        const page = await readAgentWebMessagingPageBaseAroundMessage(
            context,
            agentWebMessagingPageMessageNouns,
            {
                room: {type: "Chat", id: chatId},
                roomMetadataPromise: Promise.resolve({
                    target: {type: "Chat", id: chatId, title: "Engineering Room"},
                    description: [{type: "Text", text: "in Engineering Room"}],
                }),
                around: {startMessageIndex: 94, endMessageIndex: 106},
                limitLength,
                computeLength: async page => getMessagingPageMessageIndexes(page).length,
                buildPage: page => page,
            },
        );

        return {
            limitLength,
            messages: getMessagingPageMessageIndexes(page),
            requests: getChatMessagesListRequestParamsForChat(chatId),
        };
    }

    const results = [
        await readRange(12),
        await readRange(18),
        await readRange(30),
        await readRange(500),
    ];

    expect(results).toEqual([
        {
            limitLength: 12,
            messages: createPaginationMessageIndexRange(94, 105),
            requests: [
                {
                    path: expect.any(Object),
                    query: {limit: 30, cursor: 84},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 85, from: "End"},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 114},
                },
            ],
        },
        {
            limitLength: 18,
            messages: createPaginationMessageIndexRange(92, 109),
            requests: [
                {
                    path: expect.any(Object),
                    query: {limit: 30, cursor: 84},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 85, from: "End"},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 114},
                },
            ],
        },
        {
            limitLength: 30,
            messages: createPaginationMessageIndexRange(85, 114),
            requests: [
                {
                    path: expect.any(Object),
                    query: {limit: 30, cursor: 84},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 85, from: "End"},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 114},
                },
            ],
        },
        {
            limitLength: 500,
            messages: createPaginationMessageIndexRange(65, 134),
            requests: [
                {
                    path: expect.any(Object),
                    query: {limit: 30, cursor: 84},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 85, from: "End"},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 114},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 70, from: "End"},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 129},
                },
            ],
        },
    ]);
});

test("loads a page around the message search parameter", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChat(chatId, "Engineering Room");
    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(0, 29), {
        cursor: -11,
        limit: 30,
        totalMessageCount: 30,
    });
    mockGetChatMessagesListPage(chatId, [], {
        cursor: 0,
        direction: "End",
        limit: 15,
        totalMessageCount: 30,
    });
    mockGetChatMessagesListPage(chatId, [], {
        cursor: 29,
        limit: 15,
        totalMessageCount: 30,
    });

    const response = await callAgentWebReadTool(context, {
        path: `${path}?message=4`,
        limit: "10kb",
    });

    expect({
        messages: getPaginationMessageIndexes(response),
        requests: getChatMessagesListRequestParams(),
    }).toEqual({
        messages: createPaginationMessageIndexRange(0, 29),
        requests: [
            {
                path: {id: chatId},
                query: {limit: 30, cursor: -11},
            },
            {
                path: {id: chatId},
                query: {limit: 15, cursor: 0, from: "End"},
            },
            {
                path: {id: chatId},
                query: {limit: 15, cursor: 29},
            },
        ],
    });
});

test("loads a centered message range search parameter with different limits", async () => {
    async function readRange(limit: string) {
        const chatId = generateId<ChatId>();
        const path = await seedChatPath(chatId, "Engineering Room");

        mockGetRoomChat(chatId, "Engineering Room");
        mockGetChatMessagesListPage(chatId, createVerbosePaginationMessageRange(85, 114), {
            cursor: 84,
            limit: 30,
            totalMessageCount: 200,
        });
        mockGetChatMessagesListPage(chatId, createVerbosePaginationMessageRange(70, 84), {
            cursor: 85,
            direction: "End",
            limit: 15,
            nextCursor: 70,
            totalMessageCount: 200,
        });
        mockGetChatMessagesListPage(chatId, createVerbosePaginationMessageRange(115, 129), {
            cursor: 114,
            limit: 15,
            nextCursor: 129,
            totalMessageCount: 200,
        });

        if (limit === "12kb") {
            mockGetChatMessagesListPage(chatId, createVerbosePaginationMessageRange(55, 69), {
                cursor: 70,
                direction: "End",
                limit: 15,
                nextCursor: 55,
                totalMessageCount: 200,
            });
            mockGetChatMessagesListPage(chatId, createVerbosePaginationMessageRange(130, 144), {
                cursor: 129,
                limit: 15,
                nextCursor: 144,
                totalMessageCount: 200,
            });
            mockGetChatMessagesListPage(chatId, createVerbosePaginationMessageRange(40, 54), {
                cursor: 55,
                direction: "End",
                limit: 15,
                nextCursor: 40,
                totalMessageCount: 200,
            });
            mockGetChatMessagesListPage(chatId, createVerbosePaginationMessageRange(145, 159), {
                cursor: 144,
                limit: 15,
                nextCursor: 159,
                totalMessageCount: 200,
            });
        }

        const response = await callAgentWebReadTool(context, {
            path: `${path}?message=94-105`,
            limit,
        });

        return {
            limit,
            messages: getPaginationMessageIndexes(response),
            requests: getChatMessagesListRequestParamsForChat(chatId),
        };
    }

    const results = [
        await readRange("3kb"),
        await readRange("3.5kb"),
        await readRange("3.9kb"),
        await readRange("12kb"),
    ];

    expect(results).toEqual([
        {
            limit: "3kb",
            messages: createPaginationMessageIndexRange(93, 106),
            requests: [
                {
                    path: expect.any(Object),
                    query: {limit: 30, cursor: 84},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 85, from: "End"},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 114},
                },
            ],
        },
        {
            limit: "3.5kb",
            messages: createPaginationMessageIndexRange(92, 108),
            requests: [
                {
                    path: expect.any(Object),
                    query: {limit: 30, cursor: 84},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 85, from: "End"},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 114},
                },
            ],
        },
        {
            limit: "3.9kb",
            messages: createPaginationMessageIndexRange(91, 109),
            requests: [
                {
                    path: expect.any(Object),
                    query: {limit: 30, cursor: 84},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 85, from: "End"},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 114},
                },
            ],
        },
        {
            limit: "12kb",
            messages: createPaginationMessageIndexRange(71, 130),
            requests: [
                {
                    path: expect.any(Object),
                    query: {limit: 30, cursor: 84},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 85, from: "End"},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 114},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 70, from: "End"},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 129},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 55, from: "End"},
                },
                {
                    path: expect.any(Object),
                    query: {limit: 15, cursor: 144},
                },
            ],
        },
    ]);
});

test("loads more around-message context with half-batch requests before and after", async () => {
    const chatId = generateId<ChatId>();

    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(26, 55), {
        cursor: 25,
        limit: 30,
        totalMessageCount: 86,
    });
    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(11, 25), {
        cursor: 26,
        direction: "End",
        limit: 15,
        nextCursor: 11,
        totalMessageCount: 86,
    });
    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(56, 70), {
        cursor: 55,
        limit: 15,
        nextCursor: 70,
        totalMessageCount: 86,
    });
    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(0, 10), {
        cursor: 11,
        direction: "End",
        limit: 15,
        totalMessageCount: 86,
    });
    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(71, 85), {
        cursor: 70,
        limit: 15,
        totalMessageCount: 86,
    });

    const response = await readChatMessageForTest({chatId, aroundMessageIndex: 40});

    expect({
        messages: getPaginationMessageIndexes(response),
        requests: getChatMessagesListRequestParams(),
    }).toEqual({
        messages: createPaginationMessageIndexRange(0, 85),
        requests: [
            {
                path: {id: chatId},
                query: {limit: 30, cursor: 25},
            },
            {
                path: {id: chatId},
                query: {limit: 15, cursor: 26, from: "End"},
            },
            {
                path: {id: chatId},
                query: {limit: 15, cursor: 55},
            },
            {
                path: {id: chatId},
                query: {limit: 15, cursor: 11, from: "End"},
            },
            {
                path: {id: chatId},
                query: {limit: 15, cursor: 70},
            },
        ],
    });
});

test("adds the newer around-message context first when only one loaded message fits", async () => {
    const chatId = generateId<ChatId>();

    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(26, 55), {
        cursor: 25,
        limit: 30,
        totalMessageCount: 71,
    });
    mockGetChatMessagesListPage(
        chatId,
        [
            ...createPaginationMessageRange(11, 24),
            createPaginationMessage(25, `Message 25 ${"Older context ".repeat(400)}`),
        ],
        {
            cursor: 26,
            direction: "End",
            limit: 15,
            totalMessageCount: 71,
        },
    );
    mockGetChatMessagesListPage(
        chatId,
        [
            createPaginationMessage(56, `Message 56 ${"Newer context ".repeat(400)}`),
            ...createPaginationMessageRange(57, 70),
        ],
        {
            cursor: 55,
            limit: 15,
            totalMessageCount: 71,
        },
    );

    const response = await readChatMessageForTest({
        chatId,
        aroundMessageIndex: 40,
        limit: "9000b",
    });

    expect(getPaginationMessageIndexes(response)).toEqual(
        createPaginationMessageIndexRange(26, 56),
    );
});

test("trims an around-message page from the older side first", async () => {
    const chatId = generateId<ChatId>();

    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(0, 29), {
        cursor: -1,
        limit: 30,
        totalMessageCount: 30,
    });
    mockGetChatMessagesListPage(chatId, [], {
        cursor: 0,
        direction: "End",
        limit: 15,
        totalMessageCount: 30,
    });
    mockGetChatMessagesListPage(chatId, [], {
        cursor: 29,
        limit: 15,
        totalMessageCount: 30,
    });

    const response = await readChatMessageForTest({
        chatId,
        aroundMessageIndex: 14,
        limit: "330b",
    });

    expect(getPaginationMessageIndexes(response)).toEqual([14, 15]);
});

test("keeps the target message when trimming an around-message page from the older side", async () => {
    const chatId = generateId<ChatId>();

    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(0, 14), {
        cursor: -1,
        limit: 30,
        totalMessageCount: 15,
    });
    mockGetChatMessagesListPage(chatId, [], {
        cursor: 0,
        direction: "End",
        limit: 15,
        totalMessageCount: 15,
    });
    mockGetChatMessagesListPage(chatId, [], {
        cursor: 14,
        limit: 15,
        totalMessageCount: 15,
    });

    const response = await readChatMessageForTest({
        chatId,
        aroundMessageIndex: 14,
        limit: "260b",
    });

    expect(getPaginationMessageIndexes(response)).toEqual([14]);
});

test("keeps the target message when trimming an around-message page from the newer side", async () => {
    const chatId = generateId<ChatId>();

    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(0, 29), {
        cursor: -15,
        limit: 30,
        totalMessageCount: 30,
    });
    mockGetChatMessagesListPage(chatId, [], {
        cursor: 0,
        direction: "End",
        limit: 15,
        totalMessageCount: 30,
    });
    mockGetChatMessagesListPage(chatId, [], {
        cursor: 29,
        limit: 15,
        totalMessageCount: 30,
    });

    const response = await readChatMessageForTest({
        chatId,
        aroundMessageIndex: 0,
        limit: "260b",
    });

    expect(getPaginationMessageIndexes(response)).toEqual([0]);
});

test("alternates trimming an around-message page after dropping from the older side", async () => {
    const chatId = generateId<ChatId>();

    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(0, 29), {
        cursor: -1,
        limit: 30,
        totalMessageCount: 30,
    });
    mockGetChatMessagesListPage(chatId, [], {
        cursor: 0,
        direction: "End",
        limit: 15,
        totalMessageCount: 30,
    });
    mockGetChatMessagesListPage(chatId, [], {
        cursor: 29,
        limit: 15,
        totalMessageCount: 30,
    });

    const response = await readChatMessageForTest({
        chatId,
        aroundMessageIndex: 14,
        limit: "540b",
    });

    expect(getPaginationMessageIndexes(response)).toEqual([13, 14, 15, 16, 17]);
});

test("reads a single chat message and paginates forward through next links", async () => {
    const chatId = generateId<ChatId>();
    const chatMessagePath = await seedChatMessagePath({
        chatId,
        index: 40,
        authorShortName: "Alice",
        bodySnippet: "Message 40",
    });

    mockGetRoomChatTimes(chatId, "Engineering Room", 4);
    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(40, 44), {
        cursor: 25,
        totalMessageCount: 5,
    });
    mockGetChatMessagesListPage(chatId, [], {
        cursor: 40,
        direction: "End",
        limit: 15,
        nextCursor: null,
        totalMessageCount: 5,
    });
    mockGetChatMessagesListPage(chatId, [], {
        cursor: 44,
        nextCursor: null,
        totalMessageCount: 5,
        limit: 15,
    });
    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(41, 43), {
        cursor: 40,
        totalMessageCount: 5,
    });
    mockGetChatMessagesListPage(chatId, createPaginationMessageRange(42, 44), {
        cursor: 41,
        totalMessageCount: 5,
    });
    mockGetChatMessagesListPage(chatId, [createPaginationMessage(43)], {
        cursor: 42,
        totalMessageCount: 5,
    });

    const firstResponse = await callAgentWebReadTool(context, {
        path: chatMessagePath,
        limit: "250b",
    });
    const secondResponse = await callAgentWebReadTool(context, {
        path: readNextPagePath(firstResponse),
        limit: "220b",
    });
    const thirdResponse = await callAgentWebReadTool(context, {
        path: readNextPagePath(secondResponse),
        limit: "220b",
    });
    const fourthResponse = await callAgentWebReadTool(context, {
        path: readNextPagePath(thirdResponse),
        limit: "220b",
    });

    expect([firstResponse, secondResponse, thirdResponse, fourthResponse]).toEqual([
        `\
Some messages in Engineering Room. [« Previous page](/chat/engineering-room?before=40) | [Next page »](/chat/engineering-room?after=40)

<time>May 14th at 2:20pm EDT</time>

<message id="40" from="[Alice](/human/alice)">

Message 40

</message>`,
        `\
Some messages in Engineering Room. [Next page »](/chat/engineering-room?after=41)

<time>May 14th at 2:25pm EDT</time>

<message id="41" from="[Bob](/human/bob)">

Message 41

</message>`,
        `\
Some messages in Engineering Room. [Next page »](/chat/engineering-room?after=42)

<time>May 14th at 2:30pm EDT</time>

<message id="42" from="[Alice](/human/alice)">

Message 42

</message>`,
        `\
Some messages in Engineering Room.

<time>May 14th at 2:35pm EDT</time>

<message id="43" from="[Bob](/human/bob)">

Message 43

</message>

End of messages.`,
    ]);
});

test("trims messages to fit the read limit and exposes a previous-page link", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChat(chatId, "Engineering Room");
    mockGetChatMessagesList(chatId, [
        createMessage({
            index: 0,
            author: aliceAccount,
            createdTime: "2026-05-14T15:00:00.000Z",
            content: "Older context ".repeat(80),
        }),
        createMessage({
            index: 1,
            author: bobAccount,
            createdTime: "2026-05-14T15:05:00.000Z",
            content: "Latest update stays visible.",
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "450b"})).resolves.toEqual(`\
Some messages in Engineering Room. [Previous page »](/chat/engineering-room?before=1)

<time>May 14th at 11:05am EDT</time>

<message id="1" from="[Bob](/human/bob)">

Latest update stays visible.

</message>

End of messages.`);
});

test("caches the full chat read response for scroll", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChat(chatId, "Engineering Room");
    mockGetChatMessagesList(chatId, [
        createMessage({
            index: 0,
            author: aliceAccount,
            createdTime: "2026-05-14T15:00:00.000Z",
            content: createMarkdownContent(
                Array.from({length: 10}, (_, index) => `Paragraph ${index + 1}.`).join("\n\n"),
            ),
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "120b"})).resolves.toEqual(`\
Some messages in Engineering Room.

<time>May 14th at 11:00am EDT</time>

<message id="0" from="[Alice](/human/alice)">

(Page truncated, 169b remaining. Showing lines 1-6 of 29. Call the \`scroll\` tool with an \`offset\` of 6 to continue.)`);

    await expect(
        callAgentWebScrollTool(context, {
            path,
            offset: 12,
            limit: "10kb",
        }),
    ).resolves.toEqual(`\
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
