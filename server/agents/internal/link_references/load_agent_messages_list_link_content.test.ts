/* eslint-disable string-quotes */
import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {AgentPaginatedMessagesListLink} from "~/server/agents/internal/link_references/agent_link.js";
import {createAgentLink} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {loadAgentMessagesListLinkContent} from "~/server/agents/internal/link_references/load_agent_messages_list_link_content.js";
import {printMarkdownTree} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {
    ApiContentResponse,
    ApiMessageResponse,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assertDateString} from "~/shared/helpers/date/date_string.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    SpaceId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const storage = new DurableObjectStorage(new MemoryStorage());

afterEach(async () => {
    await storage.deleteAll();
});

const tracer = new TracerContextModule(testTracer);
const tracerRoot = tracer.getRoot();

const conversationStartDate = new Date("2025-11-21T13:05:00Z");
const conversationState = {
    startTime: conversationStartDate,
    timeZone: defaultTimeZone,
} as const;

// Helper to create sample content
function createSampleContent(...texts: Array<string>): ApiContentResponse {
    return {
        elements: texts.map(text => ({
            type: "Paragraph",
            elements: [{type: "Text", text}],
        })),
    };
}

describe("loadAgentMessagesListLinkContent", () => {
    const spaceId = generateId<SpaceId>();
    const client = new ApiClientMock();
    const request = {
        apiClient: client,
        spaceId,
    } as const;

    afterEach(() => {
        client.reset();
    });

    const aliceAccount = createApiAccountMock({
        name: "Alice",
    });
    const bobAccount = createApiAccountMock({
        name: "Bob",
    });

    describe("Renders members in chat or message page correctly", () => {
        test("loads chat messages list with one member", async () => {
            const chatId = generateId<ChatId>();

            client.mockGetChatMessagesList(spaceId, chatId, {
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Hello!"),
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                ],
            });

            const link: AgentPaginatedMessagesListLink = {
                type: "ChatMessages",
                chatId,
                paginationType: "page",
                pageNumber: 0,
                label: "Hello!",
                pageInfo: {from: "Start", index: 0},
                rootMessage: null,
                tokenLimitForPage: 1000,
            };

            const result = await storage.transaction(async transaction => {
                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                });
            });

            expect(printMarkdownTree(result)).toEqual(`\
This is a chat conversation.

<time>November 21st at 8:10am EST</time>

<human name="Alice">

Hello!

</human>
`);
        });

        test("loads chat messages list with two members", async () => {
            const chatId = generateId<ChatId>();

            client.mockGetChatMessagesList(spaceId, chatId, {
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Hello!"),
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                    {
                        index: 0,
                        author: bobAccount,
                        createdTime: assertDateString("2025-11-21T13:16:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Hello hello!"),
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                ],
            });

            const link: AgentPaginatedMessagesListLink = {
                type: "ChatMessages",
                chatId,
                paginationType: "page",
                pageNumber: 0,
                label: "Hello!",
                pageInfo: {from: "Start", index: 0},
                rootMessage: null,
                tokenLimitForPage: 1000,
            };

            const result = await storage.transaction(async transaction => {
                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                });
            });

            expect(printMarkdownTree(result)).toEqual(`\
This is a chat conversation.

<time>November 21st at 8:10am EST</time>

<human name="Alice">

Hello!

</human>

<human name="Bob">

Hello hello!

</human>
`);
        });

        test("loads chat messages list with more than two members", async () => {
            const chatId = generateId<ChatId>();
            const charlieAccount = createApiAccountMock({
                name: "Charlie",
            });
            const davidAccount = createApiAccountMock({
                name: "David",
            });

            client.mockGetChatMessagesList(spaceId, chatId, {
                totalMessageCount: 4,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Hello!"),
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                    {
                        index: 1,
                        author: bobAccount,
                        createdTime: assertDateString("2025-11-21T13:16:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Hello hello!"),
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                    {
                        index: 2,
                        author: charlieAccount,
                        createdTime: assertDateString("2025-11-21T13:17:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Hello Charlie!"),
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                    {
                        index: 3,
                        author: davidAccount,
                        createdTime: assertDateString("2025-11-21T13:18:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Hello David!"),
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                ],
            });

            const link: AgentPaginatedMessagesListLink = {
                type: "ChatMessages",
                chatId,
                paginationType: "page",
                pageNumber: 0,
                label: "Hello!",
                pageInfo: {from: "Start", index: 0},
                rootMessage: null,
                tokenLimitForPage: 1000,
            };

            const result = await storage.transaction(async transaction => {
                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                });
            });

            expect(printMarkdownTree(result)).toEqual(`\
This is a chat conversation.

<time>November 21st at 8:10am EST</time>

<human name="Alice">

Hello!

</human>

<human name="Bob">

Hello hello!

</human>

<human name="Charlie">

Hello Charlie!

</human>

<human name="David">

Hello David!

</human>
`);
        });
    });

    test("loads document comments list", async () => {
        const documentId = generateId<DocumentId>();
        const commentThreadId = generateId<DocumentCommentThreadId>();

        client.mockGetDocumentCommentsList(spaceId, documentId, commentThreadId, {
            totalMessageCount: 1,
            nextCursor: null,
            messages: [
                {
                    index: 0,
                    author: aliceAccount,
                    createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("Looks comprehensive!"),
                    },
                    createdTimeZone: defaultTimeZone,
                },
                {
                    index: 0,
                    author: bobAccount,
                    createdTime: assertDateString("2025-11-21T13:16:00.000Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("Thanks Alice!"),
                    },
                    createdTimeZone: defaultTimeZone,
                },
            ],
        });

        const link: AgentPaginatedMessagesListLink = {
            type: "DocumentCommentThreadComments",
            documentId,
            commentThreadId,
            paginationType: "page",
            pageNumber: 0,
            label: "Looks comprehensive!",
            pageInfo: {from: "Start", index: 0},
            rootMessage: null,
            tokenLimitForPage: 1000,
        };

        const result = await storage.transaction(async transaction => {
            return loadAgentMessagesListLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
                conversationState,
            });
        });

        expect(printMarkdownTree(result)).toEqual(`\
This is a conversation about a document.

<time>November 21st at 8:10am EST</time>

<human name="Alice">

Looks comprehensive!

</human>

<human name="Bob">

Thanks Alice!

</human>
`);
    });

    test("loads task comments list", async () => {
        const taskId = generateId<TaskId>();

        client.mockGetTaskCommentsList(spaceId, taskId, {
            totalMessageCount: 1,
            nextCursor: null,
            messages: [
                {
                    index: 0,
                    author: aliceAccount,
                    createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                    payload: {
                        type: "Content",
                        content: createSampleContent("Started implementation!"),
                    },
                    createdTimeZone: defaultTimeZone,
                },
            ],
        });

        const link: AgentPaginatedMessagesListLink = {
            type: "TaskComments",
            taskId,
            paginationType: "page",
            pageNumber: 0,
            label: "Started implementation!",
            pageInfo: {from: "Start", index: 0},
            rootMessage: null,
            tokenLimitForPage: 1000,
        };

        const result = await storage.transaction(async transaction => {
            return loadAgentMessagesListLinkContent({
                tracer: tracerRoot,
                transaction,
                request,
                link,
                conversationState,
            });
        });

        expect(printMarkdownTree(result)).toEqual(`\
This is a conversation about a task.

<time>November 21st at 8:10am EST</time>

<human name="Alice">

Started implementation!

</human>
`);
    });

    describe("loads the page for a single message", () => {
        const spaceId = generateId<SpaceId>();
        const client = new ApiClientMock();
        const request = {
            apiClient: client,
            spaceId,
        };

        afterEach(() => {
            client.reset();
        });

        test("loads single chat message from middle of the conversation", async () => {
            const chatId = generateId<ChatId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });
            const bobAccount = createApiAccountMock({
                name: "Bob",
            });

            client.mockGetChatMessagesList(spaceId, chatId, {
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("Hello Bob!"),
                        },
                    },
                ],
            });

            client.mockGetChatMessagesList(spaceId, chatId, {
                totalMessageCount: 2,
                nextCursor: null,
                messages: [
                    {
                        index: 1,
                        author: bobAccount,
                        createdTime: assertDateString("2025-11-21T13:16:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("Hi Alice, how are you?"),
                        },
                    },
                    {
                        index: 2,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:22:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("I'm doing great, thanks!"),
                        },
                    },
                ],
            });

            const result = await storage.transaction(async transaction => {
                const link = (await createAgentLink(storage, {
                    type: "ChatMessage",
                    chatId,
                    messageIndex: 1,
                    preview: "Hi Alice, how are you?",
                })) as AgentPaginatedMessagesListLink;
                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                });
            });

            expect(printMarkdownTree(result)).toEqual(`\
This is a chat conversation.

<time>November 21st at 8:10am EST</time>

<human name="Alice">

Hello Bob!

</human>

<human name="Bob">

Hi Alice, how are you?

</human>

<human name="Alice">

I'm doing great, thanks!

</human>
`);
        });

        test("loads single chat message from middle of the conversation with pagination", async () => {
            const chatId = generateId<ChatId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });
            const bobAccount = createApiAccountMock({
                name: "Bob",
            });

            client.mockGetChatMessagesList(spaceId, chatId, {
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("Hello Bob!"),
                        },
                    },
                ],
            });

            client.mockGetChatMessagesList(spaceId, chatId, {
                totalMessageCount: 2,
                nextCursor: null,
                messages: [
                    {
                        index: 1,
                        author: bobAccount,
                        createdTime: assertDateString("2025-11-21T13:16:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("Hi Alice, how are you?".repeat(200)),
                        },
                    },
                    {
                        index: 2,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:22:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("I'm doing great, thanks!".repeat(200)),
                        },
                    },
                ],
            });

            const result = await storage.transaction(async transaction => {
                const link = (await createAgentLink(storage, {
                    type: "ChatMessage",
                    chatId,
                    messageIndex: 1,
                    preview: "Hi Alice, how are you?",
                })) as AgentPaginatedMessagesListLink;

                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                });
            });

            expect(printMarkdownTree(result)).toEqual(`\
This is a chat conversation.

<time>November 21st at 8:10am EST</time>

<human name="Alice">

Hello Bob!

</human>

<human name="Bob">

${"Hi Alice, how are you?".repeat(200)}

</human>

[Next chunk »](/chat/hi-alice-how-are-you?chunk=1)
`);
        });

        test("loads first chat message with limited context", async () => {
            const chatId = generateId<ChatId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });

            client.mockGetChatMessagesList(spaceId, chatId, {
                totalMessageCount: 2,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("First message"),
                        },
                    },
                    {
                        index: 1,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:16:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("Second message"),
                        },
                    },
                ],
            });

            const result = await storage.transaction(async transaction => {
                const link = (await createAgentLink(storage, {
                    type: "ChatMessage",
                    chatId,
                    messageIndex: 0,
                    preview: "First message",
                })) as AgentPaginatedMessagesListLink;

                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                });
            });

            expect(printMarkdownTree(result)).toEqual(`\
This is a chat conversation.

<time>November 21st at 8:10am EST</time>

<human name="Alice">

First message

Second message

</human>
`);
        });

        test("loads chat message from start with link to next page for long conversations", async () => {
            const chatId = generateId<ChatId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });

            // Create a message with lots of content to exceed page limit
            const messages = [];
            for (let i = 0; i < 3; i++) {
                messages.push({
                    index: i,
                    author: i % 2 === 0 ? aliceAccount : bobAccount,
                    createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                    createdTimeZone: defaultTimeZone,
                    payload: {
                        type: "Content" as const,
                        content: createSampleContent("Long message content.".repeat(200)),
                    },
                });
            }

            client.mockGetChatMessagesList(spaceId, chatId, {
                totalMessageCount: messages.length,
                nextCursor: null,
                messages,
            });

            const result = await storage.transaction(async transaction => {
                const link = (await createAgentLink(storage, {
                    type: "ChatMessage",
                    chatId,
                    messageIndex: 0,
                    preview: "Long message content",
                })) as AgentPaginatedMessagesListLink;

                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                });
            });

            expect(printMarkdownTree(result)).toEqual(`\
This is a chat conversation.

<time>November 21st at 8:10am EST</time>

<human name="Alice">

${"Long message content.".repeat(200)}

</human>

[Next page »](/chat/long-message-content?page=2)
`);
        });

        test("loads chat message from start with link to previous and next pages for long conversations", async () => {
            const chatId = generateId<ChatId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });

            // Create a message with lots of content to exceed page limit
            const messages = [];
            for (let i = 0; i < 3; i++) {
                messages.push({
                    index: i + 2,
                    author: aliceAccount,
                    createdTime: assertDateString(`2025-11-21T13:1${i}:00.000Z`),
                    createdTimeZone: defaultTimeZone,
                    payload: {
                        type: "Content" as const,
                        content: createSampleContent("Long message content.".repeat(100)),
                    },
                });
            }

            client.mockGetChatMessagesList(spaceId, chatId, {
                totalMessageCount: 2,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("Hello Bob!".repeat(100)),
                        },
                    },
                    {
                        index: 1,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:16:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent(
                                "First message before the index".repeat(200),
                            ),
                        },
                    },
                ],
            });

            client.mockGetChatMessagesList(spaceId, chatId, {
                totalMessageCount: messages.length,
                nextCursor: null,
                messages,
            });

            const result = await storage.transaction(async transaction => {
                const link = (await createAgentLink(storage, {
                    type: "ChatMessage",
                    chatId,
                    messageIndex: 2,
                    preview: "Long message content",
                })) as AgentPaginatedMessagesListLink;

                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                });
            });

            expect(printMarkdownTree(result)).toEqual(`\
This is a chat conversation.

[« Previous chunk](/chat/long-message-content?chunk=-1)

<time>November 21st at 8:16am EST</time>

<human name="Alice">

${"First message before the index".repeat(200)}

${"Long message content.".repeat(100)}

</human>

[Next chunk »](/chat/long-message-content?chunk=1)
`);
        });
        test("doesn't show link to previous page if it loaded the first chat message in the chunk.", async () => {
            const chatId = generateId<ChatId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });

            // Create a message with lots of content to exceed page limit
            const messages = [];
            for (let i = 0; i < 3; i++) {
                messages.push({
                    index: i + 2,
                    author: aliceAccount,
                    createdTime: assertDateString(`2025-11-21T13:1${i}:00.000Z`),
                    createdTimeZone: defaultTimeZone,
                    payload: {
                        type: "Content" as const,
                        content: createSampleContent("Long message content.".repeat(100)),
                    },
                });
            }

            client.mockGetChatMessagesList(spaceId, chatId, {
                totalMessageCount: 2,
                nextCursor: null,
                messages: [
                    {
                        index: 1,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:17:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("First message before the index"),
                        },
                    },
                    {
                        index: 0,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:19:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("Hello Bob!"),
                        },
                    },
                ],
            });

            client.mockGetChatMessagesList(spaceId, chatId, {
                totalMessageCount: messages.length,
                nextCursor: null,
                messages,
            });

            const result = await storage.transaction(async transaction => {
                const link = (await createAgentLink(storage, {
                    type: "ChatMessage",
                    chatId,
                    messageIndex: 2,
                    preview: "Long message content",
                })) as AgentPaginatedMessagesListLink;

                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                });
            });

            expect(printMarkdownTree(result)).toEqual(`\
This is a chat conversation.

<time>November 21st at 8:17am EST</time>

<human name="Alice">

First message before the index

Hello Bob!

${"Long message content.".repeat(100)}

</human>

[Next chunk »](/chat/long-message-content?chunk=1)
`);
        });
    });

    describe("document comments", () => {
        test("loads document comment with context", async () => {
            const documentId = generateId<DocumentId>();
            const commentThreadId = generateId<DocumentCommentThreadId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });
            const bobAccount = createApiAccountMock({
                name: "Bob",
            });

            client.mockGetDocument(spaceId, documentId, {
                title: "My Document",
                content: createSampleContent("This is the document content."),
            });

            // before start index 1
            client.mockGetDocumentCommentsList(spaceId, documentId, commentThreadId, {
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("This looks great!"),
                        },
                    },
                ],
            });

            // After and including start index 1
            client.mockGetDocumentCommentsList(spaceId, documentId, commentThreadId, {
                totalMessageCount: 2,
                nextCursor: null,
                messages: [
                    {
                        index: 1,
                        author: bobAccount,
                        createdTime: assertDateString("2025-11-21T13:16:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("Thanks Alice!"),
                        },
                    },
                    {
                        index: 2,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:17:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("You're welcome!"),
                        },
                    },
                ],
            });

            const result = await storage.transaction(async transaction => {
                const link = (await createAgentLink(storage, {
                    type: "DocumentComment",
                    documentId,
                    commentThreadId,
                    commentIndex: 1,
                    preview: "Thanks Alice!",
                })) as AgentPaginatedMessagesListLink;

                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                });
            });

            expect(printMarkdownTree(result)).toEqual(`\
This is a conversation about a [document](/document/my-document).

<time>November 21st at 8:10am EST</time>

<human name="Alice">

This looks great!

</human>

<human name="Bob">

Thanks Alice!

</human>

<human name="Alice">

You're welcome!

</human>
`);
        });

        test("loads first document comment with limited context", async () => {
            const documentId = generateId<DocumentId>();
            const commentThreadId = generateId<DocumentCommentThreadId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });

            client.mockGetDocument(spaceId, documentId, {
                title: "Project Plan",
                content: createSampleContent("Project details here."),
            });

            client.mockGetDocumentCommentsList(spaceId, documentId, commentThreadId, {
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("Starting a discussion here."),
                        },
                    },
                ],
            });

            const result = await storage.transaction(async transaction => {
                const link = (await createAgentLink(storage, {
                    type: "DocumentComment",
                    documentId,
                    commentThreadId,
                    commentIndex: 0,
                    preview: "Starting a discussion here.",
                })) as AgentPaginatedMessagesListLink;

                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                });
            });

            expect(printMarkdownTree(result)).toEqual(`\
This is a conversation about a [document](/document/project-plan).

<time>November 21st at 8:10am EST</time>

<human name="Alice">

Starting a discussion here.

</human>
`);
        });

        test("loads document comment with link to next page for long threads", async () => {
            const documentId = generateId<DocumentId>();
            const commentThreadId = generateId<DocumentCommentThreadId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });

            client.mockGetDocument(spaceId, documentId, {
                title: "Long Discussion",
                content: createSampleContent("Document content."),
            });

            // Create many comments to exceed page limit
            const messages: Array<ApiMessageResponse> = [];
            for (let i = 0; i < 3; i++) {
                messages.push({
                    index: i,
                    author: aliceAccount,
                    createdTime: assertDateString(`2025-11-21T13:1${i}:00.000Z`),
                    createdTimeZone: defaultTimeZone,
                    payload: {
                        type: "Content" as const,
                        content: createSampleContent("Long comment text.".repeat(200)),
                    },
                });
            }

            client.mockGetDocumentCommentsList(spaceId, documentId, commentThreadId, {
                totalMessageCount: messages.length,
                nextCursor: null,
                messages,
            });

            const result = await storage.transaction(async transaction => {
                const link = (await createAgentLink(storage, {
                    type: "DocumentComment",
                    documentId,
                    commentThreadId,
                    commentIndex: 0,
                    preview: "Long comment text",
                })) as AgentPaginatedMessagesListLink;

                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                });
            });

            expect(printMarkdownTree(result)).toEqual(`\
This is a conversation about a [document](/document/long-discussion).

<time>November 21st at 8:10am EST</time>

<human name="Alice">

${"Long comment text.".repeat(200)}

</human>

[Next page »](/document-thread/long-comment-text?page=2)
`);
        });

        test("loads document comment with multiple messages across API requests", async () => {
            const documentId = generateId<DocumentId>();
            const commentThreadId = generateId<DocumentCommentThreadId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });
            const bobAccount = createApiAccountMock({
                name: "Bob",
            });

            client.mockGetDocument(spaceId, documentId, {
                title: "Feedback Document",
                content: createSampleContent("Content here."),
            });

            // First API request
            client.mockGetDocumentCommentsList(
                spaceId,
                documentId,
                commentThreadId,
                {
                    totalMessageCount: 2,
                    nextCursor: 1,
                    messages: [
                        {
                            index: 0,
                            author: aliceAccount,
                            createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                            createdTimeZone: defaultTimeZone,
                            payload: {
                                type: "Content",
                                content: createSampleContent("First comment."),
                            },
                        },
                        {
                            index: 1,
                            author: bobAccount,
                            createdTime: assertDateString("2025-11-21T13:16:00.000Z"),
                            createdTimeZone: defaultTimeZone,
                            payload: {
                                type: "Content",
                                content: createSampleContent("Second comment."),
                            },
                        },
                    ],
                },
                {cursor: undefined, limit: 30},
            );

            // Second API request
            client.mockGetDocumentCommentsList(
                spaceId,
                documentId,
                commentThreadId,
                {
                    totalMessageCount: 0,
                    nextCursor: null,
                    messages: [
                        {
                            index: 2,
                            author: aliceAccount,
                            createdTime: assertDateString("2025-11-21T13:17:00.000Z"),
                            createdTimeZone: defaultTimeZone,
                            payload: {
                                type: "Content",
                                content: createSampleContent("Third comment from second request."),
                            },
                        },
                    ],
                },
                {cursor: 1, limit: 30},
            );

            const result = await storage.transaction(async transaction => {
                const link = (await createAgentLink(storage, {
                    type: "DocumentComment",
                    documentId,
                    commentThreadId,
                    commentIndex: 0,
                    preview: "First comment.",
                })) as AgentPaginatedMessagesListLink;
                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                });
            });

            expect(printMarkdownTree(result)).toEqual(`\
This is a conversation about a [document](/document/feedback-document).

<time>November 21st at 8:10am EST</time>

<human name="Alice">

First comment.

</human>

<human name="Bob">

Second comment.

</human>

<human name="Alice">

Third comment from second request.

</human>
`);
        });
    });
});
