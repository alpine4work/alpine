/* eslint-disable cyberworlds/string-quotes */

import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {mockApiGetDocument} from "~/server/agents/api/test_helpers/mock_api_get_document.js";
import {AgentPaginatedMessagesListLink} from "~/server/agents/bots/internal/link_references/agent_link.js";
import {createAgentLink} from "~/server/agents/bots/internal/link_references/agent_link_collection.js";
import {loadAgentMessagesListLinkContent as actuallyLoadAgentMessagesListLinkContent} from "~/server/agents/bots/internal/link_references/load_agent_messages_list_link_content.js";
import {printAgentContentMarkdownTree} from "~/server/agents/bots/internal/print_api_content_to_agent_markdown.js";
import {addKeysToApiContentForTest} from "~/shared/api/content/test_helpers/add_keys_to_api_content_for_test.js";
import {ApiContentResponseWithOptionalKeys} from "~/shared/api/specification/types/api_content_response_without_keys.js";
import {
    ApiContentResponse,
    ApiDocumentThreadResponse,
    ApiMessageResponse,
    ApiTaskResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assertDateString, serializeDateString} from "~/shared/helpers/date/date_string.js";
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
    return addKeysToApiContentForTest({
        elements: texts.map(text => ({
            type: "Paragraph",
            elements: [{type: "Text", text}],
        })),
    });
}

async function loadAgentMessagesListLinkContent(
    options: Parameters<typeof actuallyLoadAgentMessagesListLinkContent>[0],
) {
    const {messagesContent} = await actuallyLoadAgentMessagesListLinkContent(options);
    return messagesContent;
}

function mockGetChatMessagesList(
    api: ApiClientMock,
    spaceId: SpaceId,
    chatId: ChatId,
    responseData: {
        totalMessageCount?: number;
        nextCursor?: number | null;
        messages?: ReadonlyArray<ApiMessageResponse>;
    },
): void {
    api.mockGet("/chats/{id}/messages", {
        params: "Any",
        data: {
            spaceId,
            totalMessageCount: 0,
            nextCursor: null,
            messages: [],
            ...responseData,
        },
    });
}

function mockGetDocumentThread(
    api: ApiClientMock,
    spaceId: SpaceId,
    documentId: DocumentId,
    threadId: DocumentCommentThreadId,
    responseData: Partial<{
        document: ApiDocumentThreadResponse["document"];
        isResolved: boolean;
        totalMessageCount: number;
        firstMessage: ApiDocumentThreadResponse["firstMessage"];
        documentContentSnippet: ApiContentResponseWithOptionalKeys;
    }> &
        Record<string, unknown>,
): void {
    api.mockGet("/documents/{id}/threads/{threadId}", {
        params: {path: {id: documentId, threadId}},
        data: {
            spaceId,
            thread: {
                id: threadId,
                document: responseData.document ?? {
                    id: documentId,
                    reference: {
                        title: "Test Document",
                    },
                },
                isResolved: responseData.isResolved ?? false,
                totalMessageCount: responseData.totalMessageCount ?? 0,
                firstMessage: responseData.firstMessage ?? {
                    author: createApiAccountMock({}),
                    createdTime: serializeDateString(new Date()),
                    createdTimeZone: defaultTimeZone,
                },
                documentContentSnippet: addKeysToApiContentForTest(
                    responseData.documentContentSnippet ?? {elements: []},
                ),
            },
        },
    });
}

function mockGetDocumentCommentsList(
    api: ApiClientMock,
    spaceId: SpaceId,
    documentId: DocumentId,
    threadId: DocumentCommentThreadId,
    responseData: {
        totalMessageCount?: number;
        nextCursor?: number | null;
        messages?: Array<ApiMessageResponse>;
    },
): void {
    api.mockGet("/documents/{id}/threads/{threadId}/messages", {
        params: "Any",
        data: {
            spaceId,
            totalMessageCount: 0,
            nextCursor: null,
            messages: [],
            ...responseData,
        },
    });
}

function mockGetTask(
    api: ApiClientMock,
    spaceId: SpaceId,
    taskId: TaskId,
    responseData: Partial<Omit<ApiTaskResponse, "id">>,
): void {
    api.mockGet("/tasks/{id}", {
        params: {path: {id: taskId}},
        data: {
            spaceId,
            task: {
                id: taskId,
                status: responseData.status ?? {type: "Open", isActive: true},
                title: responseData.title ?? "Test Task",
                collections: responseData.collections ?? [],
                notes: responseData.notes ?? {
                    version: 0,
                    content: addKeysToApiContentForTest(
                        createApiContentResponseWithSingleParagraph("Test Task Content"),
                    ),
                },
                ...responseData,
            },
        },
    });
}

function mockGetTaskCommentsList(
    api: ApiClientMock,
    spaceId: SpaceId,
    taskId: TaskId,
    responseData: {
        totalMessageCount?: number;
        nextCursor?: number | null;
        messages?: Array<ApiMessageResponse>;
    },
): void {
    api.mockGet("/tasks/{id}/messages", {
        params: "Any",
        data: {
            spaceId,
            totalMessageCount: 0,
            nextCursor: null,
            messages: [],
            ...responseData,
        },
    });
}

function createApiContentResponseWithSingleParagraph(
    text: string,
): ApiContentResponseWithOptionalKeys {
    return {
        elements: [
            {
                type: "Paragraph",
                elements: [{type: "Text", text}],
            },
        ],
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

            mockGetChatMessagesList(client, spaceId, chatId, {
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
                            files: [],
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
                pageInfo: {from: "Start", cursor: null},
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
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
<time>November 21st at 8:10am EST</time>

<human name="Alice">
Hello!
</human>
`);
        });

        test("loads chat messages list with two members", async () => {
            const chatId = generateId<ChatId>();

            mockGetChatMessagesList(client, spaceId, chatId, {
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
                            files: [],
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
                            files: [],
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
                pageInfo: {from: "Start", cursor: null},
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
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
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

            mockGetChatMessagesList(client, spaceId, chatId, {
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
                            files: [],
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
                            files: [],
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
                            files: [],
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
                            files: [],
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
                pageInfo: {from: "Start", cursor: null},
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
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
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

        mockGetDocumentCommentsList(client, spaceId, documentId, commentThreadId, {
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
                        files: [],
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
                        files: [],
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
            pageInfo: {from: "Start", cursor: null},
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
                tokenLimitFactor: 1,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
This is a comment thread on a document.

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

        mockGetTaskCommentsList(client, spaceId, taskId, {
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
                        files: [],
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
            pageInfo: {from: "Start", cursor: null},
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
                tokenLimitFactor: 1,
            });
        });

        expect(printAgentContentMarkdownTree(result)).toEqual(`\
These are comments on a task.

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

            mockGetChatMessagesList(client, spaceId, chatId, {
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
                            files: [],
                        },
                    },
                ],
            });

            mockGetChatMessagesList(client, spaceId, chatId, {
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
                            files: [],
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
                            files: [],
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
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
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

            mockGetChatMessagesList(client, spaceId, chatId, {
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
                            files: [],
                        },
                    },
                ],
            });

            mockGetChatMessagesList(client, spaceId, chatId, {
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
                            files: [],
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
                            files: [],
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
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
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

            mockGetChatMessagesList(client, spaceId, chatId, {
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
                            files: [],
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
                            files: [],
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
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
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
                        files: [],
                    },
                });
            }

            mockGetChatMessagesList(client, spaceId, chatId, {
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
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
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
                        files: [],
                    },
                });
            }

            mockGetChatMessagesList(client, spaceId, chatId, {
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
                            files: [],
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
                            files: [],
                        },
                    },
                ],
            });

            mockGetChatMessagesList(client, spaceId, chatId, {
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
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
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
                        files: [],
                    },
                });
            }

            mockGetChatMessagesList(client, spaceId, chatId, {
                totalMessageCount: 2,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:17:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("First message before the index"),
                            files: [],
                        },
                    },
                    {
                        index: 1,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:19:00.000Z"),
                        createdTimeZone: defaultTimeZone,
                        payload: {
                            type: "Content",
                            content: createSampleContent("Hello Bob!"),
                            files: [],
                        },
                    },
                ],
            });

            mockGetChatMessagesList(client, spaceId, chatId, {
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
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
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
        test("loads document comment with content snippet for first page of conversation", async () => {
            const documentId = generateId<DocumentId>();
            const commentThreadId = generateId<DocumentCommentThreadId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });

            mockApiGetDocument(client, {
                spaceId,
                documentId,
                version: 1,
                title: "Code Review",
                content: createSampleContent("Review this code."),
            });

            mockGetDocumentThread(client, spaceId, documentId, commentThreadId, {
                createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                isResolved: false,
                commentCount: 0,
                documentContentSnippet: {
                    elements: [
                        {
                            type: "Paragraph",
                            key: createMockApiContentKey(0),
                            elements: [
                                {type: "Text", text: "This is "},
                                {
                                    type: "Text",
                                    text: "bold",
                                    marks: [{type: "Bold"}],
                                },
                                {type: "Text", text: " and "},
                                {
                                    type: "Text",
                                    text: "italic",
                                    marks: [{type: "Italic"}],
                                },
                                {type: "Text", text: " and "},
                                {
                                    type: "Text",
                                    text: "myFunction()",
                                    marks: [{type: "Code"}],
                                },
                                {type: "Text", text: " inline code. "},
                                {
                                    type: "Mention",
                                    target: {type: "Account", id: aliceAccount.id},
                                    title: aliceAccount.name,
                                },
                                {type: "Text", text: " is going to take care of this!!."},
                            ],
                        },
                    ],
                },
            });

            mockGetDocumentCommentsList(client, spaceId, documentId, commentThreadId, {
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
                            files: [],
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                    {
                        index: 1,
                        author: bobAccount,
                        createdTime: assertDateString("2025-11-21T13:16:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Thanks Alice!"),
                            files: [],
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                ],
            });

            const result = await storage.transaction(async transaction => {
                const link = (await createAgentLink(storage, {
                    type: "DocumentComment",
                    documentId,
                    commentThreadId,
                    commentIndex: 0,
                    preview: "This is bold",
                })) as AgentPaginatedMessagesListLink;

                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
This is a comment thread on the document \u201C[Code Review](/document/code-review).\u201D The following is a \
preview of the document near the comment. The specific text this comment was left on is wrapped in \
\`<comment></comment>\`.

<document_preview>
This is **bold** and *italic* and \`myFunction()\` inline code. [Alice](/account/alice) is going to take care of this!!.
</document_preview>

<time>November 21st at 8:10am EST</time>

<human name="Alice">
Looks comprehensive!
</human>

<human name="Bob">
Thanks Alice!
</human>
`);
        });
        test("filters out other comment thread marks from other comments in the same snippet", async () => {
            const documentId = generateId<DocumentId>();
            const commentThreadId = generateId<DocumentCommentThreadId>();
            const threadId2 = generateId<DocumentCommentThreadId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });

            mockApiGetDocument(client, {
                spaceId,
                documentId,
                version: 1,
                title: "Code Review",
                content: createSampleContent("Review this code."),
            });

            mockGetDocumentThread(client, spaceId, documentId, commentThreadId, {
                createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                isResolved: false,
                commentCount: 0,
                documentContentSnippet: {
                    elements: [
                        {
                            type: "Paragraph",
                            key: createMockApiContentKey(0),
                            elements: [
                                {
                                    type: "Text",
                                    text: "Next, something outrageous happened. The Eagles sought to defend their title (and honor) in the 2025-2026 season. ",
                                    marks: [{type: "Comment", threadId: commentThreadId}],
                                },
                                {
                                    type: "Text",
                                    text: "They promoted a ",
                                    marks: [
                                        {type: "Comment", threadId: commentThreadId},
                                        {type: "Comment", threadId: threadId2},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: "water boy",
                                    marks: [
                                        {type: "Comment", threadId: commentThreadId},
                                        {type: "Comment", threadId: threadId2},
                                        {type: "Italic"},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: " ",
                                    marks: [
                                        {type: "Comment", threadId: commentThreadId},
                                        {type: "Comment", threadId: threadId2},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: "to captain",
                                    marks: [
                                        {type: "Comment", threadId: commentThreadId},
                                        {type: "Comment", threadId: threadId2},
                                        {type: "Bold"},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: " to the ",
                                    marks: [
                                        {type: "Comment", threadId: commentThreadId},
                                        {type: "Comment", threadId: threadId2},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: "head",
                                    marks: [
                                        {type: "Comment", threadId: commentThreadId},
                                        {type: "Comment", threadId: threadId2},
                                        {type: "Strike"},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: " of their ",
                                    marks: [
                                        {type: "Comment", threadId: commentThreadId},
                                        {type: "Comment", threadId: threadId2},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: "army",
                                    marks: [
                                        {type: "Comment", threadId: commentThreadId},
                                        {type: "Comment", threadId: threadId2},
                                        {type: "Highlight", color: "Orange"},
                                    ],
                                },
                                {
                                    type: "Text",
                                    text: ".",
                                    marks: [
                                        {type: "Comment", threadId: commentThreadId},
                                        {type: "Comment", threadId: threadId2},
                                    ],
                                },
                            ],
                        },
                    ],
                },
            });

            mockGetDocumentCommentsList(client, spaceId, documentId, commentThreadId, {
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
                            files: [],
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                    {
                        index: 1,
                        author: bobAccount,
                        createdTime: assertDateString("2025-11-21T13:16:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Thanks Alice!"),
                            files: [],
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                ],
            });

            const result = await storage.transaction(async transaction => {
                const link = (await createAgentLink(storage, {
                    type: "DocumentComment",
                    documentId,
                    commentThreadId,
                    commentIndex: 0,
                    preview: "This is bold",
                })) as AgentPaginatedMessagesListLink;

                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
This is a comment thread on the document \u201C[Code Review](/document/code-review).\u201D The following is a preview of the document near the comment. The specific text this comment was left on is wrapped in \`<comment></comment>\`.

<document_preview>
<comment>Next, something outrageous happened. The Eagles sought to defend their title (and honor) in the 2025-2026 season. They promoted a *water boy* **to captain** to the ~~head~~ of their <mark class="highlight-orange">army</mark>.</comment>
</document_preview>

<time>November 21st at 8:10am EST</time>

<human name="Alice">
Looks comprehensive!
</human>

<human name="Bob">
Thanks Alice!
</human>
`);
        });

        test("shows document link the first time a conversation is loaded but doesn't show comment snippet if not the first page", async () => {
            const documentId = generateId<DocumentId>();
            const commentThreadId = generateId<DocumentCommentThreadId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });

            mockApiGetDocument(client, {
                spaceId,
                documentId,
                version: 1,
                title: "Code Review",
                content: createSampleContent("Review this code."),
            });

            mockGetDocumentCommentsList(client, spaceId, documentId, commentThreadId, {
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 3,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Looks comprehensive!"),
                            files: [],
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                    {
                        index: 4,
                        author: bobAccount,
                        createdTime: assertDateString("2025-11-21T13:16:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Thanks Alice!"),
                            files: [],
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                ],
            });

            const result = await storage.transaction(async transaction => {
                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link: {
                        type: "DocumentCommentThreadComments",
                        documentId,
                        commentThreadId,
                        label: "This is bold",
                        paginationType: "chunk",
                        pageNumber: 0,
                        pageInfo: {from: "Start", cursor: 2},
                        tokenLimitForPage: 1000,
                        rootMessage: null,
                    },
                    conversationState,
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
This is a comment thread on the document \u201C[Code Review](/document/code-review).\u201D

<time>November 21st at 8:10am EST</time>

<human name="Alice">
Looks comprehensive!
</human>

<human name="Bob">
Thanks Alice!
</human>
`);
        });

        test("loads document comment without a content snippet", async () => {
            const documentId = generateId<DocumentId>();
            const commentThreadId = generateId<DocumentCommentThreadId>();

            mockApiGetDocument(client, {
                spaceId,
                documentId,
                version: 1,
                title: "Resources Doc",
                content: createSampleContent("Links to resources."),
            });

            mockGetDocumentThread(client, spaceId, documentId, commentThreadId, {
                createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                isResolved: false,
                commentCount: 0,
                documentContentSnippet: {elements: []},
            });

            mockGetDocumentCommentsList(client, spaceId, documentId, commentThreadId, {
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: bobAccount,
                        createdTime: assertDateString("2025-11-21T13:16:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Good stuff!"),
                            files: [],
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                ],
            });

            const result = await storage.transaction(async transaction => {
                const link = (await createAgentLink(storage, {
                    type: "DocumentComment",
                    documentId,
                    commentThreadId,
                    commentIndex: 0,
                    preview: "Check out this article",
                })) as AgentPaginatedMessagesListLink;

                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link,
                    conversationState,
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
This is a comment thread on the document \u201C[Resources Doc](/document/resources-doc).\u201D

<time>November 21st at 8:16am EST</time>

<human name="Bob">
Good stuff!
</human>
`);
        });

        test("doesn't add content snippet or link to content if it's not the first page of the conversation", async () => {
            const documentId = generateId<DocumentId>();
            const commentThreadId = generateId<DocumentCommentThreadId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });

            mockGetDocumentCommentsList(client, spaceId, documentId, commentThreadId, {
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 3,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("First comment."),
                            files: [],
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                ],
            });

            const result = await storage.transaction(async transaction => {
                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link: {
                        type: "DocumentCommentThreadComments",
                        documentId,
                        commentThreadId,
                        label: "First comment",
                        paginationType: "page",
                        pageNumber: 3,
                        pageInfo: {from: "Start", cursor: 1},
                        tokenLimitForPage: 1000,
                        rootMessage: null,
                    },
                    conversationState,
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
This is a comment thread on a document.

<time>November 21st at 8:10am EST</time>

<human name="Alice">
First comment.
</human>
`);
        });

        test("doesn't add content snippet or link to content if it's not the first chunk of the conversation", async () => {
            const documentId = generateId<DocumentId>();
            const commentThreadId = generateId<DocumentCommentThreadId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });

            mockGetDocumentCommentsList(client, spaceId, documentId, commentThreadId, {
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 5,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Long comment.".repeat(100)),
                            files: [],
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                ],
            });

            const result = await storage.transaction(async transaction => {
                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link: {
                        type: "DocumentCommentThreadComments",
                        documentId,
                        commentThreadId,
                        label: "First comment",
                        paginationType: "chunk",
                        pageNumber: 1,
                        pageInfo: {from: "Start", cursor: 3},
                        tokenLimitForPage: 1000,
                        rootMessage: null,
                    },
                    conversationState,
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
This is a comment thread on a document.

<time>November 21st at 8:10am EST</time>

<human name="Alice">
${"Long comment.".repeat(100)}
</human>
`);
        });
    });

    describe("task comments", () => {
        test("loads task comment with link to task for first page of conversation", async () => {
            const taskId = generateId<TaskId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });

            mockGetTask(client, spaceId, taskId, {
                title: "Implement Feature X",
            });

            mockGetTaskCommentsList(client, spaceId, taskId, {
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Started working on this!"),
                            files: [],
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                ],
            });

            const result = await storage.transaction(async transaction => {
                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link: {
                        type: "TaskComments",
                        taskId,
                        label: "Started working on this",
                        paginationType: "page",
                        pageNumber: 1,
                        pageInfo: {from: "Start", cursor: null},
                        tokenLimitForPage: 1000,
                        rootMessage: null,
                    },
                    conversationState,
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
These are comments on a [task](/task/implement-feature-x).

<time>November 21st at 8:10am EST</time>

<human name="Alice">
Started working on this!
</human>
`);
        });

        test("loads task comment without link to task for non-first page of conversation", async () => {
            const taskId = generateId<TaskId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });

            mockGetTaskCommentsList(client, spaceId, taskId, {
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 3,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Making progress!"),
                            files: [],
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                ],
            });

            const result = await storage.transaction(async transaction => {
                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link: {
                        type: "TaskComments",
                        taskId,
                        label: "Making progress",
                        paginationType: "page",
                        pageNumber: 3,
                        pageInfo: {from: "Start", cursor: 1},
                        tokenLimitForPage: 1000,
                        rootMessage: null,
                    },
                    conversationState,
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
These are comments on a task.

<time>November 21st at 8:10am EST</time>

<human name="Alice">
Making progress!
</human>
`);
        });

        test("loads task comment with link to task for first chunk of conversation", async () => {
            const taskId = generateId<TaskId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });

            mockGetTask(client, spaceId, taskId, {
                title: "Implement Feature X",
            });

            mockGetTaskCommentsList(client, spaceId, taskId, {
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 0,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Investigating the issue."),
                            files: [],
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                ],
            });

            const result = await storage.transaction(async transaction => {
                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link: {
                        type: "TaskComments",
                        taskId,
                        label: "Investigating the issue",
                        paginationType: "chunk",
                        pageNumber: 0,
                        pageInfo: {from: "Start", cursor: null},
                        tokenLimitForPage: 1000,
                        rootMessage: null,
                    },
                    conversationState,
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
These are comments on a [task](/task/implement-feature-x).

<time>November 21st at 8:10am EST</time>

<human name="Alice">
Investigating the issue.
</human>
`);
        });

        test("loads task comment without link to task for non-first chunk of conversation", async () => {
            const taskId = generateId<TaskId>();
            const aliceAccount = createApiAccountMock({
                name: "Alice",
            });

            mockGetTaskCommentsList(client, spaceId, taskId, {
                totalMessageCount: 1,
                nextCursor: null,
                messages: [
                    {
                        index: 5,
                        author: aliceAccount,
                        createdTime: assertDateString("2025-11-21T13:10:00.000Z"),
                        payload: {
                            type: "Content",
                            content: createSampleContent("Detailed review notes."),
                            files: [],
                        },
                        createdTimeZone: defaultTimeZone,
                    },
                ],
            });

            const result = await storage.transaction(async transaction => {
                return loadAgentMessagesListLinkContent({
                    tracer: tracerRoot,
                    transaction,
                    request,
                    link: {
                        type: "TaskComments",
                        taskId,
                        label: "Detailed review notes",
                        paginationType: "chunk",
                        pageNumber: 1,
                        pageInfo: {from: "Start", cursor: 3},
                        tokenLimitForPage: 1000,
                        rootMessage: null,
                    },
                    conversationState,
                    tokenLimitFactor: 1,
                });
            });

            expect(printAgentContentMarkdownTree(result)).toEqual(`\
These are comments on a task.

<time>November 21st at 8:10am EST</time>

<human name="Alice">
Detailed review notes.
</human>
`);
        });
    });
});
