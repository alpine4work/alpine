import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {searchAlpineForAgent} from "~/server/agents/internal/tools/search_alpine_for_agent.js";
import {ApiSearchResult} from "~/shared/api/types/api_specification_convenience_types.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentId,
    PostId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const storage = new DurableObjectStorage(new MemoryStorage());
const spaceId = generateId<SpaceId>();

const documentId = generateId<DocumentId>();
const postId = generateId<PostId>();
const taskId = generateId<TaskId>();
const chatId = generateId<ChatId>();
const accountId = generateId<AccountId>();
const channelId = generateId<ChannelId>();
const taskCollectionId = generateId<TaskCollectionId>();

const apiClient = new ApiClientMock();
const request = {
    spaceId,
    apiClient,
} as const;

afterEach(async () => {
    await storage.deleteAll();
});

describe("searchAlpineForAgent", () => {
    test("returns ‘No results found’ when results array is empty", async () => {
        apiClient.mockGet("/spaces/{id}/search", {data: {results: []}});

        const result = await storage.transaction(async transaction =>
            searchAlpineForAgent(testTracer, transaction, request, "test query"),
        );

        expect(result).toBe("No results found");
    });

    test("handles search results without body matches", async () => {
        const results: Array<ApiSearchResult> = [
            {
                type: "Document",
                path: `/documents/${documentId}`,
                title: "Test Document",
                bodyMatch: null,
                id: documentId,
            },
            {
                type: "Post",
                path: `/posts/${postId}`,
                title: "Test Post",
                bodyMatch: null,
                id: postId,
                author: createApiAccountMock({id: accountId, name: "John Smith"}),
            },
            {
                type: "Task",
                path: `/tasks/${taskId}`,
                title: "Test Task Open active",
                bodyMatch: null,
                status: {
                    type: "Open",
                    isActive: true,
                },
                id: taskId,
            },
            {
                type: "Task",
                path: `/tasks/${taskId}`,
                title: "Test Task Open inactive",
                bodyMatch: null,
                status: {
                    type: "Open",
                    isActive: false,
                },
                id: taskId,
            },
            {
                type: "Task",
                path: `/tasks/${taskId}`,
                title: "Test Task Closed",
                bodyMatch: null,
                status: {type: "Closed"},
                id: taskId,
            },
            {
                type: "TaskMessage",
                path: `/tasks/${taskId}/messages/5`,
                title: null,
                bodyMatch: null,
                author: createApiAccountMock({id: accountId, name: "John Smith"}),
                id: taskId,
                index: 5,
            },
            {
                type: "TaskCollection",
                path: `/task-collections/${taskCollectionId}`,
                title: "Test Collection",
                bodyMatch: null,
                id: taskCollectionId,
            },
            {
                type: "Chat",
                path: `/chats/${chatId}`,
                title: "Test Chat",
                bodyMatch: null,
                id: chatId,
            },
            {
                type: "Account",
                path: `/accounts/${accountId}`,
                title: "Test Account",
                bodyMatch: null,
                id: accountId,
            },
            {
                type: "Channel",
                path: `/channels/${channelId}`,
                title: "Test Channel",
                bodyMatch: null,
                id: channelId,
            },
            {
                type: "ChatMessage",
                path: `/chats/${chatId}/messages/5`,
                title: null,
                bodyMatch: [],
                author: createApiAccountMock({id: accountId, name: "John Smith"}),
                id: chatId,
                index: 5,
            },
        ];

        apiClient.mockGet("/spaces/{id}/search", {data: {results}});

        const result = await storage.transaction(async transaction =>
            searchAlpineForAgent(testTracer, transaction, request, "query"),
        );

        expect(result).toEqual(`\
1. [Test Document](/document/test-document)

2. [Test Post](/post/test-post)

3. [Test Task Open active](/task/test-task-open-active)

4. [Test Task Open inactive](/task/test-task-open-inactive)

5. [Test Task Closed](/task/test-task-closed)

6. [John: Unknown task comment](/task-comments/john-unknown-task-comment)

7. [Test Collection](/task-collection/test-collection)

8. [Test Chat](/chat/test-chat)

9. [Test Account](/account/test-account)

10. [Test Channel](/channel/test-channel)

11. [John: Unknown chat message](/chat/john-unknown-chat-message)
`);
    });

    test("handles search results with body matches", async () => {
        const results: Array<ApiSearchResult> = [
            {
                type: "Document",
                path: `/documents/${documentId}`,
                title: "Test Document",
                bodyMatch: [{text: "Test Document", isMatch: true}, {text: " test document"}],
                id: documentId,
            },
            {
                type: "Post",
                path: `/posts/${postId}`,
                title: "Test Post",
                bodyMatch: [
                    {text: "Test Post", isMatch: true},
                    {text: " not highlighted "},
                    {text: "hello world", isMatch: true},
                    {text: " test post"},
                ],
                author: createApiAccountMock({id: accountId, name: "John Smith"}),
                id: postId,
            },
            {
                type: "Task",
                path: `/tasks/${taskId}`,
                title: "Test Task Open active",
                bodyMatch: [
                    {text: "Test Task Open active", isMatch: true},
                    {text: " "},
                    {text: "hello world", isMatch: true},
                    {text: " test task open active"},
                ],
                status: {
                    type: "Open",
                    isActive: true,
                },
                id: taskId,
            },
            {
                type: "Task",
                path: `/tasks/${taskId}`,
                title: "Test Task Open inactive",
                bodyMatch: [],
                status: {
                    type: "Open",
                    isActive: false,
                },
                id: taskId,
            },
            {
                type: "Task",
                path: `/tasks/${taskId}`,
                title: "Test Task Closed",
                bodyMatch: [
                    {text: "Test Task Closed", isMatch: true},
                    {text: " "},
                    {text: "hello world", isMatch: true},
                    {text: " test task closed"},
                ],
                status: {type: "Closed"},
                id: taskId,
            },
            {
                type: "TaskMessage",
                path: `/tasks/${taskId}/messages/5`,
                title: null,
                bodyMatch: [{text: "test task message"}],
                author: createApiAccountMock({id: accountId, name: "John Smith"}),
                id: taskId,
                index: 5,
            },
            {
                type: "TaskCollection",
                path: `/task-collections/${taskCollectionId}`,
                title: "Test Collection",
                bodyMatch: null,
                id: taskCollectionId,
            },
            {
                type: "Chat",
                path: `/chats/${chatId}`,
                title: "Test Chat",
                bodyMatch: null,
                id: chatId,
            },
            {
                type: "Account",
                path: `/accounts/${accountId}`,
                title: "Test Account",
                bodyMatch: null,
                id: accountId,
            },
            {
                type: "Channel",
                path: `/channels/${channelId}`,
                title: "Test Channel",
                bodyMatch: null,
                id: channelId,
            },
            {
                type: "ChatMessage",
                path: `/chats/${chatId}/messages/5`,
                title: null,
                bodyMatch: [],
                author: createApiAccountMock({id: accountId, name: "John Smith"}),
                id: chatId,
                index: 5,
            },
        ];

        apiClient.mockGet("/spaces/{id}/search", {data: {results}});

        const result = await storage.transaction(async transaction =>
            searchAlpineForAgent(testTracer, transaction, request, "query"),
        );

        expect(result).toEqual(`\
1. [Test Document](/document/test-document)

   **Test Document** test document

2. [Test Post](/post/test-post)

   **Test Post** not highlighted **hello world** test post

3. [Test Task Open active](/task/test-task-open-active)

   **Test Task Open active** **hello world** test task open active

4. [Test Task Open inactive](/task/test-task-open-inactive)

5. [Test Task Closed](/task/test-task-closed)

   **Test Task Closed** **hello world** test task closed

6. [John: Unknown task comment](/task-comments/john-unknown-task-comment)

   test task message

7. [Test Collection](/task-collection/test-collection)

8. [Test Chat](/chat/test-chat)

9. [Test Account](/account/test-account)

10. [Test Channel](/channel/test-channel)

11. [John: Unknown chat message](/chat/john-unknown-chat-message)
`);
    });
});
