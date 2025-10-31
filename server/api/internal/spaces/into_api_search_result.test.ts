import {intoApiSearchResult} from "~/server/api/internal/spaces/into_api_search_result.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {SearchEntityResultModel} from "~/shared/search/search_entity_result_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

describe("intoApiSearchResult", () => {
    const accountId = generateId<AccountId>();

    describe("AccountModel", () => {
        test("converts AccountModel to API Account result", () => {
            const accountModel = new AccountModel({
                id: accountId,
                name: "Test User",
                version: 1,
                avatar: null,
                nameVersion: 1,
                reactionCharacter: null,
                space: {
                    version: 1,
                    addedTime: new Date(),
                    state: {type: "Active"},
                    role: "Member",
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model: accountModel,
                    score: 1.0,
                    bodyTextSnippet: [],
                }),
            );

            expect(result).toEqual({
                type: "Account",
                path: `/accounts/${accountId}`,
                id: accountId,
                title: "Test User",
                bodyMatch: null,
            });
        });
    });

    describe("body match handling", () => {
        test("returns null bodyMatch when bodyTextSnippet is empty", () => {
            const documentId = generateId<DocumentId>();
            const model = new SearchEntityModel({
                id: `Document:${documentId}`,
                title: "Test Document",
                titleVersion: null,
                media: null,
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                }),
            );

            expect(result).toEqual({
                type: "Document",
                path: `/documents/${documentId}`,
                id: documentId,
                title: "Test Document",
                bodyMatch: null,
            });
        });

        test("converts bodyTextSnippet with highlighted text", () => {
            const documentId = generateId<DocumentId>();
            const model = new SearchEntityModel({
                id: `Document:${documentId}`,
                title: "Test Document",
                titleVersion: null,
                media: null,
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [
                        {text: "This is ", isHighlighted: false},
                        {text: "highlighted", isHighlighted: true},
                        {text: " text", isHighlighted: false},
                    ],
                }),
            );

            expect(result).toEqual({
                type: "Document",
                path: `/documents/${documentId}`,
                id: documentId,
                title: "Test Document",
                bodyMatch: [
                    {text: "This is "},
                    {text: "highlighted", isMatch: true},
                    {text: " text"},
                ],
            });
        });

        test("converts bodyTextSnippet without highlighted text", () => {
            const documentId = generateId<DocumentId>();
            const model = new SearchEntityModel({
                id: `Document:${documentId}`,
                title: "Test Document",
                titleVersion: null,
                media: null,
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Plain text", isHighlighted: false}],
                }),
            );

            expect(result).toEqual({
                type: "Document",
                path: `/documents/${documentId}`,
                id: documentId,
                title: "Test Document",
                bodyMatch: [{text: "Plain text"}],
            });
        });
    });

    describe("Channel", () => {
        test("converts Channel entity to API result", () => {
            const channelId = generateId<ChannelId>();
            const model = new SearchEntityModel({
                id: `Channel:${channelId}`,
                title: "General Channel",
                titleVersion: null,
                media: null,
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                }),
            );

            expect(result).toEqual({
                type: "Channel",
                path: `/channels/${channelId}`,
                id: channelId,
                title: "General Channel",
                bodyMatch: null,
            });
        });

        test("handles Channel with null title", () => {
            const channelId = generateId<ChannelId>();
            const model = new SearchEntityModel({
                id: `Channel:${channelId}`,
                title: null,
                titleVersion: null,
                media: null,
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                }),
            );

            expect(result).toEqual({
                type: "Channel",
                path: `/channels/${channelId}`,
                id: channelId,
                title: "Unknown",
                bodyMatch: null,
            });
        });
    });

    describe("Chat", () => {
        test("converts Chat entity to API result", () => {
            const chatId = generateId<ChatId>();
            const model = new SearchEntityModel({
                id: `Chat:${chatId}`,
                title: "Team Discussion",
                titleVersion: null,
                media: null,
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                }),
            );

            expect(result).toEqual({
                type: "Chat",
                path: `/chats/${chatId}`,
                id: chatId,
                title: "Team Discussion",
                bodyMatch: null,
            });
        });

        test("handles Chat with null title", () => {
            const chatId = generateId<ChatId>();
            const model = new SearchEntityModel({
                id: `Chat:${chatId}`,
                title: null,
                titleVersion: null,
                media: null,
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                }),
            );

            expect(result).toEqual({
                type: "Chat",
                path: `/chats/${chatId}`,
                id: chatId,
                title: "Unknown",
                bodyMatch: null,
            });
        });
    });

    describe("ChatMessage", () => {
        test("converts ChatMessage entity to API result", () => {
            const chatId = generateId<ChatId>();
            const messageIndex = 5;
            const authorId = generateId<AccountId>();
            const authorModel = createTestAccountModel({
                id: authorId,
                name: "Message Author",
            });

            const model = new SearchEntityModel({
                id: `ChatMessage:${chatId}-${messageIndex}`,
                title: null,
                titleVersion: null,
                media: {
                    type: "Account",
                    account: authorModel,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Hello world", isHighlighted: true}],
                }),
            );

            expect(result).toEqual({
                type: "ChatMessage",
                path: `/chats/${chatId}/messages/${messageIndex}`,
                id: chatId,
                index: messageIndex,
                title: null,
                bodyMatch: [{text: "Hello world", isMatch: true}],
                author: expect.objectContaining({
                    id: authorId,
                    name: "Message Author",
                }),
            });
        });
    });

    describe("Document", () => {
        test("converts Document entity to API result", () => {
            const documentId = generateId<DocumentId>();
            const model = new SearchEntityModel({
                id: `Document:${documentId}`,
                title: "Project Proposal",
                titleVersion: null,
                media: null,
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Document content", isHighlighted: false}],
                }),
            );

            expect(result).toEqual({
                type: "Document",
                path: `/documents/${documentId}`,
                id: documentId,
                title: "Project Proposal",
                bodyMatch: [{text: "Document content"}],
            });
        });

        test("handles Document with null title", () => {
            const documentId = generateId<DocumentId>();
            const model = new SearchEntityModel({
                id: `Document:${documentId}`,
                title: null,
                titleVersion: null,
                media: null,
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                }),
            );

            expect(result).toEqual({
                type: "Document",
                path: `/documents/${documentId}`,
                id: documentId,
                title: "Unknown",
                bodyMatch: null,
            });
        });
    });

    describe("DocumentComment", () => {
        test("converts DocumentComment entity to API result", () => {
            const documentId = generateId<DocumentId>();
            const commentThreadId = generateId<DocumentCommentThreadId>();
            const commentIndex = 3;
            const authorId = generateId<AccountId>();
            const authorModel = createTestAccountModel({
                id: authorId,
                name: "Comment Author",
            });

            const model = new SearchEntityModel({
                id: `DocumentComment:${documentId}-${commentThreadId}-${commentIndex}`,
                title: null,
                titleVersion: null,
                media: {
                    type: "Account",
                    account: authorModel,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Great point!", isHighlighted: true}],
                }),
            );

            expect(result).toEqual({
                type: "DocumentMessage",
                path: `/documents/${documentId}/threads/${commentThreadId}/messages/${commentIndex}`,
                id: documentId,
                threadId: commentThreadId,
                index: commentIndex,
                title: null,
                bodyMatch: [{text: "Great point!", isMatch: true}],
                author: expect.objectContaining({
                    id: authorId,
                    name: "Comment Author",
                }),
            });
        });
    });

    describe("Post", () => {
        test("converts Post entity to API result", () => {
            const postId = generateId<PostId>();
            const authorId = generateId<AccountId>();
            const authorModel = createTestAccountModel({
                id: authorId,
                name: "Post Author",
            });

            const model = new SearchEntityModel({
                id: `Post:${postId}`,
                title: "Announcement",
                titleVersion: null,
                media: {
                    type: "Account",
                    account: authorModel,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Post content", isHighlighted: false}],
                }),
            );

            expect(result).toEqual({
                type: "Post",
                path: `/posts/${postId}`,
                id: postId,
                title: "Announcement",
                bodyMatch: [{text: "Post content"}],
                author: expect.objectContaining({
                    id: authorId,
                    name: "Post Author",
                }),
            });
        });

        test("handles Post with null title using fallback", () => {
            const postId = generateId<PostId>();
            const authorId = generateId<AccountId>();
            const authorModel = createTestAccountModel({
                id: authorId,
                name: "Post Author",
            });

            const model = new SearchEntityModel({
                id: `Post:${postId}`,
                title: null,
                titleVersion: null,
                media: {
                    type: "Account",
                    account: authorModel,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                }),
            );

            expect(result).toEqual({
                type: "Post",
                path: `/posts/${postId}`,
                id: postId,
                title: "Unknown",
                bodyMatch: null,
                author: expect.objectContaining({
                    id: authorId,
                    name: "Post Author",
                }),
            });
        });
    });

    describe("PostComment", () => {
        test("converts PostComment entity to API result", () => {
            const postId = generateId<PostId>();
            const commentIndex = 7;
            const authorId = generateId<AccountId>();
            const authorModel = createTestAccountModel({
                id: authorId,
                name: "Comment Author",
            });

            const model = new SearchEntityModel({
                id: `PostComment:${postId}-${commentIndex}`,
                title: null,
                titleVersion: null,
                media: {
                    type: "Account",
                    account: authorModel,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Nice post!", isHighlighted: true}],
                }),
            );

            expect(result).toEqual({
                type: "PostMessage",
                path: `/posts/${postId}/messages/${commentIndex}`,
                id: postId,
                index: commentIndex,
                title: null,
                bodyMatch: [{text: "Nice post!", isMatch: true}],
                author: expect.objectContaining({
                    id: authorId,
                    name: "Comment Author",
                }),
            });
        });
    });

    describe("Task", () => {
        test("converts Task entity with OpenInactive status to API result", () => {
            const taskId = generateId<TaskId>();
            const model = new SearchEntityModel({
                id: `Task:${taskId}`,
                title: "Fix the bug",
                titleVersion: null,
                media: {
                    type: "TaskDisplayStatus",
                    displayStatus: "OpenInactive",
                    version: expect.any(Array),
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Task description", isHighlighted: false}],
                }),
            );

            expect(result).toEqual({
                type: "Task",
                path: `/tasks/${taskId}`,
                id: taskId,
                title: "Fix the bug",
                bodyMatch: [{text: "Task description"}],
                status: {type: "Open", isActive: false},
            });
        });

        test("converts Task entity with OpenActive status to API result", () => {
            const taskId = generateId<TaskId>();
            const model = new SearchEntityModel({
                id: `Task:${taskId}`,
                title: "Implement feature",
                titleVersion: null,
                media: {
                    type: "TaskDisplayStatus",
                    displayStatus: "OpenActive",
                    version: expect.any(Array),
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                }),
            );

            expect(result).toEqual({
                type: "Task",
                path: `/tasks/${taskId}`,
                id: taskId,
                title: "Implement feature",
                bodyMatch: null,
                status: {type: "Open", isActive: true},
            });
        });

        test("converts Task entity with Closed status to API result", () => {
            const taskId = generateId<TaskId>();
            const model = new SearchEntityModel({
                id: `Task:${taskId}`,
                title: "Completed task",
                titleVersion: null,
                media: {
                    type: "TaskDisplayStatus",
                    displayStatus: "Closed",
                    version: expect.any(Array),
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                }),
            );

            expect(result).toEqual({
                type: "Task",
                path: `/tasks/${taskId}`,
                id: taskId,
                title: "Completed task",
                bodyMatch: null,
                status: {type: "Closed"},
            });
        });

        test("handles Task with null title", () => {
            const taskId = generateId<TaskId>();
            const model = new SearchEntityModel({
                id: `Task:${taskId}`,
                title: null,
                titleVersion: null,
                media: {
                    type: "TaskDisplayStatus",
                    displayStatus: "OpenActive",
                    version: expect.any(Array),
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                }),
            );

            expect(result).toEqual({
                type: "Task",
                path: `/tasks/${taskId}`,
                id: taskId,
                title: "Unknown",
                bodyMatch: null,
                status: {type: "Open", isActive: true},
            });
        });
    });

    describe("TaskCollection", () => {
        test("converts TaskCollection entity to API result", () => {
            const collectionId = generateId<TaskCollectionId>();
            const model = new SearchEntityModel({
                id: `TaskCollection:${collectionId}`,
                title: "Sprint 1 Tasks",
                titleVersion: null,
                media: null,
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                }),
            );

            expect(result).toEqual({
                type: "TaskCollection",
                path: `/task-collections/${collectionId}`,
                id: collectionId,
                title: "Sprint 1 Tasks",
                bodyMatch: null,
            });
        });

        test("handles TaskCollection with null title", () => {
            const collectionId = generateId<TaskCollectionId>();
            const model = new SearchEntityModel({
                id: `TaskCollection:${collectionId}`,
                title: null,
                titleVersion: null,
                media: null,
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                }),
            );

            expect(result).toEqual({
                type: "TaskCollection",
                path: `/task-collections/${collectionId}`,
                id: collectionId,
                title: "Unknown",
                bodyMatch: null,
            });
        });
    });

    describe("TaskComment", () => {
        test("converts TaskComment entity to API result", () => {
            const taskId = generateId<TaskId>();
            const commentIndex = 2;
            const authorId = generateId<AccountId>();
            const authorModel = createTestAccountModel({
                id: authorId,
                name: "Task Commenter",
            });

            const model = new SearchEntityModel({
                id: `TaskComment:${taskId}-${commentIndex}`,
                title: null,
                titleVersion: null,
                media: {
                    type: "Account",
                    account: authorModel,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Working on it", isHighlighted: true}],
                }),
            );

            expect(result).toEqual({
                type: "TaskMessage",
                path: `/tasks/${taskId}/messages/${commentIndex}`,
                id: taskId,
                index: commentIndex,
                title: null,
                bodyMatch: [{text: "Working on it", isMatch: true}],
                author: expect.objectContaining({
                    id: authorId,
                    name: "Task Commenter",
                }),
            });
        });
    });

    describe("static search entities", () => {
        test("returns null for static search entity ID", () => {
            const model = new SearchEntityModel({
                id: "TaskPersonal",
                title: "My Tasks",
                titleVersion: null,
                media: null,
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                }),
            );

            expect(result).toBeNull();
        });
    });
});
