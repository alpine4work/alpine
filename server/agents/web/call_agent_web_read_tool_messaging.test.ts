import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {printAgentWebPageLinkPathname} from "~/server/agents/web/agent_web_page_link.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {callAgentWebScrollTool} from "~/server/agents/web/call_agent_web_scroll_tool.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {parseApiContentFromMarkdown} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {
    ApiAccount,
    ApiContentResponse,
    ApiMessageContentPayloadParentContentSnippet,
    ApiMessageResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InternalError} from "~/shared/error/error.js";
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

<human name="Alice">

Hello world!

</human>`);
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

<human name="Alice">

Hello!

</human>

<human name="Bob">

Hello hello!

</human>`);
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

<human name="Alice">

First message

Second message

</human>`);
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

<human name="Alice">

First message

</human>

<human name="Alice" time="30 minutes later">

Second message

</human>`);
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

<human name="Alice">

Morning message

</human>

<time>May 14th at 12:00pm EDT</time>

<human name="Alice">

Noon message

</human>`);
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

<bot name="Assistant">

Hello human!

</bot>`);
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

<bot name="Alice &amp; Bob&#39;s &quot;Bot&quot;">

Hello

</bot>`);
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

<human name="Alice">

Review **carefully** in [Release Plan](/document/release-plan) before running \`deploy\`.

</human>`);
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

<human name="Alice" timezone="PDT">

Hello from the west coast.

</human>`);
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

<bot name="Assistant">

I keep bot messages timezone-free.

</bot>`);
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
                index: 0,
                contentSnippet: createParentSnippet("Can you review the rollout?"),
            },
            content: "Taking a look now.",
        }),
    ]);

    await expect(callAgentWebReadTool(context, {path, limit: "10kb"})).resolves.toEqual(`\
Some messages in Engineering Room.

<time>May 14th at 11:05am EDT</time>

<human name="Bob">

<blockquote cite="Alice">

Can you review the rollout?

</blockquote>

Taking a look now.

</human>`);
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

<human name="Bob">

<blockquote cite="Alice">

Can you review \\[\u2026]

</blockquote>

Taking a look now.

</human>`);
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

<human name="Alice">

Deleted message

</human>`);
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

<human name="Alice">

Older context

</human>

<human name="Bob">

Still relevant

</human>`);

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

<human name="Alice">

Newer context

</human>

<human name="Bob">

Latest reply

</human>`);

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

test("throws on invalid before and after search parameters", async () => {
    const chatId = generateId<ChatId>();
    const path = await seedChatPath(chatId, "Engineering Room");

    mockGetRoomChat(chatId, "Engineering Room");
    await expect(
        callAgentWebReadTool(context, {path: `${path}?before=abc`, limit: "10kb"}),
    ).rejects.toThrow("Expected `before` search param to be a positive integer");

    mockGetRoomChat(chatId, "Engineering Room");
    await expect(
        callAgentWebReadTool(context, {path: `${path}?after=-1`, limit: "10kb"}),
    ).rejects.toThrow("Expected `after` search param to be a positive integer");

    mockGetRoomChat(chatId, "Engineering Room");
    await expect(
        callAgentWebReadTool(context, {path: `${path}?before=3&after=4`, limit: "10kb"}),
    ).rejects.toThrow("Expected only one pagination search param");
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
        await callAgentWebReadTool(context, {path, limit: "230b"}),
        await callAgentWebReadTool(context, {path: `${path}?before=8`, limit: "230b"}),
        await callAgentWebReadTool(context, {path: `${path}?before=6`, limit: "230b"}),
        await callAgentWebReadTool(context, {path: `${path}?before=4`, limit: "230b"}),
        await callAgentWebReadTool(context, {path: `${path}?before=2`, limit: "230b"}),
    ];

    expect(responses).toEqual([
        `\
Some messages in Engineering Room. [Previous page »](/chat/engineering-room?before=8)

<time>May 14th at 11:40am EDT</time>

<human name="Alice">

Message 8

</human>

<human name="Bob">

Message 9

</human>`,
        `\
Some messages in Engineering Room. [Previous page »](/chat/engineering-room?before=6)

<time>May 14th at 11:30am EDT</time>

<human name="Alice">

Message 6

</human>

<human name="Bob">

Message 7

</human>`,
        `\
Some messages in Engineering Room. [Previous page »](/chat/engineering-room?before=4)

<time>May 14th at 11:20am EDT</time>

<human name="Alice">

Message 4

</human>

<human name="Bob">

Message 5

</human>`,
        `\
Some messages in Engineering Room. [Previous page »](/chat/engineering-room?before=2)

<time>May 14th at 11:10am EDT</time>

<human name="Alice">

Message 2

</human>

<human name="Bob">

Message 3

</human>`,
        `\
Some messages in Engineering Room.

<time>May 14th at 11:00am EDT</time>

<human name="Alice">

Message 0

</human>

<human name="Bob">

Message 1

</human>`,
    ]);
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
        limit: "220b",
    });
    const secondResponse = await callAgentWebReadTool(context, {
        path: readNextPagePath(firstResponse),
        limit: "180b",
    });
    const thirdResponse = await callAgentWebReadTool(context, {
        path: readNextPagePath(secondResponse),
        limit: "180b",
    });
    const fourthResponse = await callAgentWebReadTool(context, {
        path: readNextPagePath(thirdResponse),
        limit: "180b",
    });

    expect([firstResponse, secondResponse, thirdResponse, fourthResponse]).toEqual([
        `\
Some messages in Engineering Room. [« Previous page](/chat/engineering-room?before=40) | [Next page »](/chat/engineering-room?after=40)

<time>May 14th at 2:20pm EDT</time>

<human name="Alice">

Message 40

</human>`,
        `\
Some messages in Engineering Room. [Next page »](/chat/engineering-room?after=41)

<time>May 14th at 2:25pm EDT</time>

<human name="Bob">

Message 41

</human>`,
        `\
Some messages in Engineering Room. [Next page »](/chat/engineering-room?after=42)

<time>May 14th at 2:30pm EDT</time>

<human name="Alice">

Message 42

</human>`,
        `\
Some messages in Engineering Room.

<time>May 14th at 2:35pm EDT</time>

<human name="Bob">

Message 43

</human>`,
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

<human name="Bob">

Latest update stays visible.

</human>`);
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

<human name="Alice">

Paragraph 1.

(Page truncated, 135b remaining. Showing lines 1-8 of 27. Call the \`scroll\` tool with an \`offset\` of 8 to continue.)`);

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

</human>

(End of file. Showing lines 13-27 of 27.)`);
});
