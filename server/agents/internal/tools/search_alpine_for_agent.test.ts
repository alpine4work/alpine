/* eslint-disable string-quotes */
import {DurableObjectStorage} from "@miniflare/durable-objects";
import {MemoryStorage} from "@miniflare/storage-memory";
import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {createApiAccountMock} from "~/server/agents/api/test_helpers/create_api_account_mock.js";
import {searchAlpineForAgent} from "~/server/agents/internal/tools/search_alpine_for_agent.js";
import {ApiMessageRoomPathObject} from "~/shared/api/parse_api_path.js";
import {ApiSearchResult} from "~/shared/api/types/api_specification_convenience_types.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
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
    // Default room for tests that don't care about filtering
    room: cast<ApiMessageRoomPathObject>({type: "Chat", id: generateId()}),
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
# Other results

The following search results matched the keyword search but did not match any specific filters.

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
# Other results

The following search results matched the keyword search but did not match any specific filters.

1. [Test Document](/document/test-document)

   **Test Document** test document

2. [Test Post](/post/test-post)

   **Test Post** not highlighted **hello world** test post

3. [Test Task Open active](/task/test-task-open-active)

   **Test Task Open active** **hello world** test task open active

4. [Test Task Open inactive](/task/test-task-open-inactive)

5. [Test Task Closed](/task/test-task-closed)

   **Test Task Closed** **hello world** test task closed

6. [John: test task message](/task-comments/john-test-task-message)

7. [Test Collection](/task-collection/test-collection)

8. [Test Chat](/chat/test-chat)

9. [Test Account](/account/test-account)

10. [Test Channel](/channel/test-channel)

11. [John: Unknown chat message](/chat/john-unknown-chat-message)
`);
    });

    test("returns ‘No results found’ when all results are in the current message room", async () => {
        const currentChatId = generateId<ChatId>();
        const results: Array<ApiSearchResult> = [
            {
                type: "Chat",
                path: `/chats/${currentChatId}`,
                title: "Test Chat",
                bodyMatch: null,
                id: currentChatId,
            },
        ];

        apiClient.mockGet("/spaces/{id}/search", {data: {results}});

        const requestWithRoom = {
            ...request,
            room: cast<ApiMessageRoomPathObject>({type: "Chat", id: currentChatId}),
        };

        const result = await storage.transaction(async transaction =>
            searchAlpineForAgent(testTracer, transaction, requestWithRoom, "query"),
        );

        expect(result).toBe("No results found");
    });

    test("filters out results from current Chat room", async () => {
        const currentChatId = generateId<ChatId>();
        const otherChatId = generateId<ChatId>();

        const results: Array<ApiSearchResult> = [
            {
                type: "Chat",
                path: `/chats/${currentChatId}`,
                title: "Current Chat",
                bodyMatch: null,
                id: currentChatId,
            },
            {
                type: "ChatMessage",
                path: `/chats/${currentChatId}/messages/5`,
                title: null,
                bodyMatch: [],
                author: createApiAccountMock({id: accountId, name: "John Smith"}),
                id: currentChatId,
                index: 5,
            },
            {
                type: "Chat",
                path: `/chats/${otherChatId}`,
                title: "Other Chat",
                bodyMatch: null,
                id: otherChatId,
            },
            {
                type: "ChatMessage",
                path: `/chats/${otherChatId}/messages/3`,
                title: null,
                bodyMatch: [],
                author: createApiAccountMock({id: accountId, name: "Jane Doe"}),
                id: otherChatId,
                index: 3,
            },
        ];

        apiClient.mockGet("/spaces/{id}/search", {data: {results}});

        const requestWithRoom = {
            ...request,
            room: cast<ApiMessageRoomPathObject>({type: "Chat", id: currentChatId}),
        };

        const result = await storage.transaction(async transaction =>
            searchAlpineForAgent(testTracer, transaction, requestWithRoom, "query"),
        );

        // Should only include results from other chat, not current chat
        expect(result).toEqual(`\
# Other results

The following search results matched the keyword search but did not match any specific filters.

1. [Other Chat](/chat/other-chat)

2. [Jane: Unknown chat message](/chat/jane-unknown-chat-message)
`);
    });

    test("filters out results from current Post room", async () => {
        const currentPostId = generateId<PostId>();
        const otherPostId = generateId<PostId>();

        const results: Array<ApiSearchResult> = [
            {
                type: "Post",
                path: `/posts/${currentPostId}`,
                title: "Current Post",
                bodyMatch: null,
                author: createApiAccountMock({id: accountId, name: "John Smith"}),
                id: currentPostId,
            },
            {
                type: "PostMessage",
                path: `/posts/${currentPostId}/messages/2`,
                title: null,
                bodyMatch: null,
                author: createApiAccountMock({id: accountId, name: "John Smith"}),
                id: currentPostId,
                index: 2,
            },
            {
                type: "Post",
                path: `/posts/${otherPostId}`,
                title: "Other Post",
                bodyMatch: null,
                author: createApiAccountMock({id: accountId, name: "Jane Doe"}),
                id: otherPostId,
            },
            {
                type: "PostMessage",
                path: `/posts/${otherPostId}/messages/1`,
                title: null,
                bodyMatch: null,
                author: createApiAccountMock({id: accountId, name: "Jane Doe"}),
                id: otherPostId,
                index: 1,
            },
        ];

        apiClient.mockGet("/spaces/{id}/search", {data: {results}});

        const requestWithRoom = {
            ...request,
            room: cast<ApiMessageRoomPathObject>({type: "Post", id: currentPostId}),
        };

        const result = await storage.transaction(async transaction =>
            searchAlpineForAgent(testTracer, transaction, requestWithRoom, "query"),
        );

        // Should only include results from other post, not current post
        expect(result).toEqual(`\
# Other results

The following search results matched the keyword search but did not match any specific filters.

1. [Other Post](/post/other-post)

2. [Jane: Unknown post comment](/post/jane-unknown-post-comment)
`);
    });

    test("filters out results from current Task room", async () => {
        const currentTaskId = generateId<TaskId>();
        const otherTaskId = generateId<TaskId>();

        const results: Array<ApiSearchResult> = [
            {
                type: "Task",
                path: `/tasks/${currentTaskId}`,
                title: "Current Task",
                bodyMatch: null,
                status: {type: "Open", isActive: true},
                id: currentTaskId,
            },
            {
                type: "TaskMessage",
                path: `/tasks/${currentTaskId}/messages/3`,
                title: null,
                bodyMatch: null,
                author: createApiAccountMock({id: accountId, name: "John Smith"}),
                id: currentTaskId,
                index: 3,
            },
            {
                type: "Task",
                path: `/tasks/${otherTaskId}`,
                title: "Other Task",
                bodyMatch: null,
                status: {type: "Open", isActive: false},
                id: otherTaskId,
            },
            {
                type: "TaskMessage",
                path: `/tasks/${otherTaskId}/messages/1`,
                title: null,
                bodyMatch: null,
                author: createApiAccountMock({id: accountId, name: "Jane Doe"}),
                id: otherTaskId,
                index: 1,
            },
        ];

        apiClient.mockGet("/spaces/{id}/search", {data: {results}});

        const requestWithRoom = {
            ...request,
            room: cast<ApiMessageRoomPathObject>({type: "Task", id: currentTaskId}),
        };

        const result = await storage.transaction(async transaction =>
            searchAlpineForAgent(testTracer, transaction, requestWithRoom, "query"),
        );

        // Should include task entities (not filtered) but only comments from other task
        expect(result).toEqual(`\
# Other results

The following search results matched the keyword search but did not match any specific filters.

1. [Current Task](/task/current-task)

2. [Other Task](/task/other-task)

3. [Jane: Unknown task comment](/task-comments/jane-unknown-task-comment)
`);
    });

    test("filters out results from current DocumentCommentThread room", async () => {
        const currentDocumentId = generateId<DocumentId>();
        const currentThreadId = generateId<DocumentCommentThreadId>();
        const otherDocumentId = generateId<DocumentId>();
        const otherThreadId = generateId<DocumentCommentThreadId>();

        const results: Array<ApiSearchResult> = [
            {
                type: "Document",
                path: `/documents/${currentDocumentId}`,
                title: "Current Document",
                bodyMatch: null,
                id: currentDocumentId,
            },
            {
                type: "DocumentMessage",
                path: `/documents/${currentDocumentId}/threads/${currentThreadId}/messages/2`,
                title: null,
                bodyMatch: null,
                author: createApiAccountMock({id: accountId, name: "John Smith"}),
                id: currentDocumentId,
                index: 2,
                threadId: currentThreadId,
            },
            {
                type: "Document",
                path: `/documents/${otherDocumentId}`,
                title: "Other Document",
                bodyMatch: null,
                id: otherDocumentId,
            },
            {
                type: "DocumentMessage",
                path: `/documents/${otherDocumentId}/threads/${otherThreadId}/messages/1`,
                title: null,
                bodyMatch: null,
                author: createApiAccountMock({id: accountId, name: "Jane Doe"}),
                id: otherDocumentId,
                index: 1,
                threadId: otherThreadId,
            },
        ];

        apiClient.mockGet("/spaces/{id}/search", {data: {results}});

        const requestWithRoom = {
            ...request,
            room: cast<ApiMessageRoomPathObject>({
                type: "DocumentCommentThread",
                id: currentDocumentId,
                threadId: currentThreadId,
            }),
        };

        const result = await storage.transaction(async transaction =>
            searchAlpineForAgent(testTracer, transaction, requestWithRoom, "query"),
        );

        // Should include both documents (not message rooms) and messages from other thread
        expect(result).toEqual(`\
# Other results

The following search results matched the keyword search but did not match any specific filters.

1. [Current Document](/document/current-document)

2. [Other Document](/document/other-document)

3. [Jane: Unknown document comment](/document-thread/jane-unknown-document-comment)
`);
    });

    test("returns ‘No results found’ when all results are filtered out", async () => {
        const currentChatId = generateId<ChatId>();

        const results: Array<ApiSearchResult> = [
            {
                type: "Chat",
                path: `/chats/${currentChatId}`,
                title: "Current Chat",
                bodyMatch: null,
                id: currentChatId,
            },
            {
                type: "ChatMessage",
                path: `/chats/${currentChatId}/messages/1`,
                title: null,
                bodyMatch: [],
                author: createApiAccountMock({id: accountId, name: "John Smith"}),
                id: currentChatId,
                index: 1,
            },
            {
                type: "ChatMessage",
                path: `/chats/${currentChatId}/messages/2`,
                title: null,
                bodyMatch: [],
                author: createApiAccountMock({id: accountId, name: "Jane Doe"}),
                id: currentChatId,
                index: 2,
            },
        ];

        apiClient.mockGet("/spaces/{id}/search", {data: {results}});

        const requestWithRoom = {
            ...request,
            room: cast<ApiMessageRoomPathObject>({type: "Chat", id: currentChatId}),
        };

        const result = await storage.transaction(async transaction =>
            searchAlpineForAgent(testTracer, transaction, requestWithRoom, "query"),
        );

        expect(result).toBe("No results found");
    });

    test("preserves highlights in links and handles long body matches", async () => {
        const currentDocumentId = generateId<DocumentId>();
        const currentThreadId = generateId<DocumentCommentThreadId>();
        const otherDocumentId = generateId<DocumentId>();
        const otherThreadId = generateId<DocumentCommentThreadId>();

        const results: Array<ApiSearchResult> = [
            {
                type: "DocumentMessage",
                path: `/documents/${otherDocumentId}/threads/${otherThreadId}/messages/1`,
                title: null,
                bodyMatch: [
                    {text: "Important", isMatch: true},
                    {text: " document comment "},
                    {text: "keyword", isMatch: true},
                    {text: " with a really long body match that will be displayed"},
                    {text: " outside of the link itself"},
                ],
                author: createApiAccountMock({id: accountId, name: "Jane Doe"}),
                id: otherDocumentId,
                index: 1,
                threadId: otherThreadId,
            },
            {
                type: "ChatMessage",
                path: `/chats/${chatId}/messages/10`,
                title: null,
                bodyMatch: [
                    {text: "This", isMatch: true},
                    {text: " is a "},
                    {text: "short", isMatch: true},
                    {text: " message"},
                ],
                author: createApiAccountMock({id: accountId, name: "John Smith"}),
                id: chatId,
                index: 10,
            },
            {
                type: "PostMessage",
                path: `/posts/${postId}/messages/3`,
                title: null,
                bodyMatch: [
                    {text: "Check out this amazing post about "},
                    {text: "technology", isMatch: true},
                    {text: " and "},
                    {text: "innovation", isMatch: true},
                    {
                        text: " in the modern world where we discuss many fascinating topics",
                    },
                ],
                author: createApiAccountMock({id: accountId, name: "Alice Johnson"}),
                id: postId,
                index: 3,
            },
            {
                type: "TaskMessage",
                path: `/tasks/${taskId}/messages/7`,
                title: null,
                bodyMatch: [
                    {
                        text: "We need to update the documentation with all the latest changes and improvements",
                    },
                ],
                author: createApiAccountMock({id: accountId, name: "Bob Wilson"}),
                id: taskId,
                index: 7,
            },
            {
                type: "ChatMessage",
                path: `/chats/${chatId}/messages/15`,
                title: null,
                bodyMatch: [
                    {text: "search", isMatch: true},
                    {text: " "},
                    {text: "term", isMatch: true},
                    {text: " appears at start then more "},
                    {text: "matches", isMatch: true},
                    {text: " scattered throughout the entire message body"},
                ],
                author: createApiAccountMock({id: accountId, name: "Carol Davis"}),
                id: chatId,
                index: 15,
            },
        ];

        apiClient.mockGet("/spaces/{id}/search", {data: {results}});

        const requestWithRoom = {
            ...request,
            room: cast<ApiMessageRoomPathObject>({
                type: "DocumentCommentThread",
                id: currentDocumentId,
                threadId: currentThreadId,
            }),
        };

        const result = await storage.transaction(async transaction =>
            searchAlpineForAgent(testTracer, transaction, requestWithRoom, "query"),
        );

        expect(result).toEqual(`\
# Other results

The following search results matched the keyword search but did not match any specific filters.

1. [Jane: **Important** document comment **keyword** with a really long](/document-thread/jane-important-document-comment-keyword-with-a-rea) body match that will be displayed outside of the link itself

2. [John: **This** is a **short** message](/chat/john-this-is-a-short-message)

3. [Alice: Check out this amazing post about **technology** and **innovation**](/post/alice-check-out-this-amazing-post-about-technology) in the modern world where we discuss many fascinating topics

4. [Bob: We need to update the documentation with all the latest](/task-comments/bob-we-need-to-update-the-documentation-with-all-t) changes and improvements

5. [Carol: **search** **term** appears at start then more **matches** scattered](/chat/carol-search-term-appears-at-start-then-more-match) throughout the entire message body
`);
    });

    test("does not filter non-message-room entities (Accounts, Channels, Documents, TaskCollections)", async () => {
        const currentChatId = generateId<ChatId>();

        const results: Array<ApiSearchResult> = [
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
                type: "Document",
                path: `/documents/${documentId}`,
                title: "Test Document",
                bodyMatch: null,
                id: documentId,
            },
            {
                type: "TaskCollection",
                path: `/task-collections/${taskCollectionId}`,
                title: "Test Collection",
                bodyMatch: null,
                id: taskCollectionId,
            },
        ];

        apiClient.mockGet("/spaces/{id}/search", {data: {results}});

        const requestWithRoom = {
            ...request,
            room: cast<ApiMessageRoomPathObject>({type: "Chat", id: currentChatId}),
        };

        const result = await storage.transaction(async transaction =>
            searchAlpineForAgent(testTracer, transaction, requestWithRoom, "query"),
        );

        // All non-message-room entities should be included regardless of current room
        expect(result).toEqual(`\
# Other results

The following search results matched the keyword search but did not match any specific filters.

1. [Test Account](/account/test-account)

2. [Test Channel](/channel/test-channel)

3. [Test Document](/document/test-document)

4. [Test Collection](/task-collection/test-collection)
`);
    });

    test("groups results by parsed filter", async () => {
        const documentId2 = generateId<DocumentId>();
        const results: Array<ApiSearchResult> = [
            {
                type: "Document",
                path: `/documents/${documentId}`,
                title: "Matching Document 1",
                bodyMatch: [{text: "content", isMatch: true}],
                parsedFilter: {summary: "documents created yesterday"},
                id: documentId,
            },
            {
                type: "Document",
                path: `/documents/${documentId2}`,
                title: "Matching Document 2",
                bodyMatch: null,
                parsedFilter: {summary: "documents created yesterday"},
                id: documentId2,
            },
            {
                type: "Post",
                path: `/posts/${postId}`,
                title: "Non-matching Post",
                bodyMatch: [{text: "post content"}],
                author: createApiAccountMock({id: accountId, name: "John Smith"}),
                id: postId,
            },
            {
                type: "Task",
                path: `/tasks/${taskId}`,
                title: "Non-matching Task",
                bodyMatch: null,
                status: {type: "Open", isActive: true},
                id: taskId,
            },
        ];

        apiClient.mockGet("/spaces/{id}/search", {data: {results}});

        const result = await storage.transaction(async transaction =>
            searchAlpineForAgent(testTracer, transaction, request, "query"),
        );

        expect(result).toEqual(`\
# Matching results

The following search results are all documents created yesterday.

1. [Matching Document 1](/document/matching-document-1)

   **content**

2. [Matching Document 2](/document/matching-document-2)

# Other results

The following search results are \\_not\\_ documents created yesterday but Alpine thought might be relevant anyway. Use your best judgement when determining if they're actually useful for responding to the user's request.

1. [Non-matching Post](/post/non-matching-post)

   post content

2. [Non-matching Task](/task/non-matching-task)
`);
    });

    test("creates multiple parsed filter groups if there are different matched filters.", async () => {
        const documentId2 = generateId<DocumentId>();
        const results: Array<ApiSearchResult> = [
            {
                type: "Document",
                path: `/documents/${documentId}`,
                title: "Matching Document 1",
                bodyMatch: [{text: "content", isMatch: true}],
                parsedFilter: {summary: "documents created yesterday"},
                id: documentId,
            },
            {
                type: "Document",
                path: `/documents/${documentId2}`,
                title: "Matching Document 2",
                bodyMatch: null,
                parsedFilter: {summary: "documents created yesterday"},
                id: documentId2,
            },
            {
                type: "Post",
                path: `/posts/${postId}`,
                title: "Non-matching Post",
                bodyMatch: [{text: "post content"}],
                author: createApiAccountMock({id: accountId, name: "John Smith"}),
                id: postId,
                parsedFilter: {summary: "posts created yesterday"},
            },
            {
                type: "Task",
                path: `/tasks/${taskId}`,
                title: "Non-matching Task",
                bodyMatch: null,
                status: {type: "Open", isActive: true},
                id: taskId,
            },
        ];

        apiClient.mockGet("/spaces/{id}/search", {data: {results}});

        const result = await storage.transaction(async transaction =>
            searchAlpineForAgent(testTracer, transaction, request, "query"),
        );

        expect(result).toEqual(`\
# Matching results

The following search results are all documents created yesterday.

1. [Matching Document 1](/document/matching-document-1)

   **content**

2. [Matching Document 2](/document/matching-document-2)

# Matching results

The following search results are all posts created yesterday.

1. [Non-matching Post](/post/non-matching-post)

   post content

# Other results

The following search results are \\_not\\_ documents created yesterday or posts created yesterday but Alpine thought might be relevant anyway. Use your best judgement when determining if they're actually useful for responding to the user's request.

1. [Non-matching Task](/task/non-matching-task)
`);
    });
});
