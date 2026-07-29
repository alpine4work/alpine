import {intoApiSearchResult} from "~/server/api/internal/spaces/into_api_search_result.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    BotId,
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
import {emptyTaskTitleModel} from "~/shared/tasks/title/task_title.js";

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
                    state: {type: "Active", activatedTime: new Date()},
                    role: "Member",
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model: accountModel,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                title: "Test User",
                titleMatch: [{length: 9}],
                body: null,
                bodyMatch: null,
                type: "Account",
                id: accountId,
                shortName: "Test",
            });
        });

        test("converts bot AccountModel to API Account result", () => {
            const accountModel = new AccountModel({
                id: accountId,
                botId: generateId<BotId>(),
                name: "Test Bot",
                version: 1,
                avatar: null,
                nameVersion: 1,
                reactionCharacter: null,
                space: {
                    version: 1,
                    addedTime: new Date(),
                    state: {type: "Active", activatedTime: new Date()},
                    role: "Member",
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model: accountModel,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                title: "Test Bot",
                titleMatch: [{length: 8}],
                body: null,
                bodyMatch: null,
                type: "Account",
                id: accountId,
                shortName: "Test",
                bot: {id: accountModel.botId},
            });
        });
    });

    describe("body match handling", () => {
        test("returns null bodyMatch when bodyTextSnippet is empty", () => {
            const documentId = generateId<DocumentId>();
            const model = new SearchEntityModel({
                type: "Document",
                title: "Test Document",
                document: {
                    id: documentId,
                    version: 0,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "Document",
                id: documentId,
                title: "Test Document",
                titleMatch: [{length: 13}],
                body: null,
                bodyMatch: null,
            });
        });

        test("converts bodyTextSnippet with highlighted text", () => {
            const documentId = generateId<DocumentId>();
            const model = new SearchEntityModel({
                type: "Document",
                title: "Test Document",
                document: {
                    id: documentId,
                    version: 0,
                },
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
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "Document",
                id: documentId,
                title: "Test Document",
                titleMatch: [{length: 13}],
                body: "This is highlighted text",
                bodyMatch: [{length: 8}, {length: 11, isMatch: true}, {length: 5}],
            });
        });

        test("converts bodyTextSnippet without highlighted text", () => {
            const documentId = generateId<DocumentId>();
            const model = new SearchEntityModel({
                type: "Document",
                title: "Test Document",
                document: {
                    id: documentId,
                    version: 0,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Plain text", isHighlighted: false}],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "Document",
                id: documentId,
                title: "Test Document",
                titleMatch: [{length: 13}],
                body: "Plain text",
                bodyMatch: [{length: 10}],
            });
        });
    });

    describe("title match handling", () => {
        test("approximately highlights title words matched by the query", () => {
            const chatId = generateId<ChatId>();
            const model = new SearchEntityModel({
                type: "Chat",
                title: "Direct chat setup",
                chat: {
                    id: chatId,
                    version: 0,
                    media: {
                        type: "AccountPile",
                        previewAccounts: [],
                        accountCount: 0,
                    },
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
                "Direct chat setup",
            );

            expect(result).toEqual({
                type: "Chat",
                id: chatId,
                title: "Direct chat setup",
                titleMatch: [
                    {length: 6, isMatch: true},
                    {length: 1},
                    {length: 4, isMatch: true},
                    {length: 1},
                    {length: 5, isMatch: true},
                ],
                body: null,
                bodyMatch: null,
            });
        });
    });

    describe("Channel", () => {
        test("converts Channel entity to API result", () => {
            const channelId = generateId<ChannelId>();
            const model = new SearchEntityModel({
                type: "Channel",
                title: "General Channel",
                channel: {
                    id: channelId,
                    version: 0,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "Channel",
                id: channelId,
                title: "General Channel",
                titleMatch: [{length: 15}],
                body: null,
                bodyMatch: null,
            });
        });

        test("handles Channel with null title", () => {
            const channelId = generateId<ChannelId>();
            const model = new SearchEntityModel({
                type: "Channel",
                title: null,
                channel: {
                    id: channelId,
                    version: 0,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "Channel",
                id: channelId,
                title: "Unknown channel",
                titleMatch: [{length: 15}],
                body: null,
                bodyMatch: null,
            });
        });
    });

    describe("Chat", () => {
        test("converts Chat entity to API result", () => {
            const chatId = generateId<ChatId>();
            const model = new SearchEntityModel({
                type: "Chat",
                title: "Team Discussion",
                chat: {
                    id: chatId,
                    version: 0,
                    media: {
                        type: "AccountPile",
                        previewAccounts: [],
                        accountCount: 0,
                    },
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "Chat",
                id: chatId,
                title: "Team Discussion",
                titleMatch: [{length: 15}],
                body: null,
                bodyMatch: null,
            });
        });

        test("handles Chat with null title", () => {
            const chatId = generateId<ChatId>();
            const model = new SearchEntityModel({
                type: "Chat",
                title: null,
                chat: {
                    id: chatId,
                    version: 0,
                    media: {
                        type: "AccountPile",
                        previewAccounts: [],
                        accountCount: 0,
                    },
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "Chat",
                id: chatId,
                title: "Unknown chat",
                titleMatch: [{length: 12}],
                body: null,
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
                type: "ChatMessage",
                title: null,
                message: {
                    chatId,
                    index: messageIndex,
                    author: authorModel,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Hello world", isHighlighted: true}],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "ChatMessage",
                id: chatId,
                index: messageIndex,
                title: null,
                titleMatch: null,
                body: "Hello world",
                bodyMatch: [{length: 11, isMatch: true}],
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
                type: "Document",
                title: "Project Proposal",
                document: {
                    id: documentId,
                    version: 0,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Document content", isHighlighted: false}],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "Document",
                id: documentId,
                title: "Project Proposal",
                titleMatch: [{length: 16}],
                body: "Document content",
                bodyMatch: [{length: 16}],
            });
        });

        test("handles Document with null title", () => {
            const documentId = generateId<DocumentId>();
            const model = new SearchEntityModel({
                type: "Document",
                title: null,
                document: {
                    id: documentId,
                    version: 0,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "Document",
                id: documentId,
                title: "Unknown document",
                titleMatch: [{length: 16}],
                body: null,
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
                type: "DocumentComment",
                title: null,
                comment: {
                    documentId,
                    commentThreadId,
                    index: commentIndex,
                    author: authorModel,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Great point!", isHighlighted: true}],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "DocumentMessage",
                id: documentId,
                threadId: commentThreadId,
                index: commentIndex,
                title: null,
                titleMatch: null,
                body: "Great point!",
                bodyMatch: [{length: 12, isMatch: true}],
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
                type: "Post",
                title: "Announcement",
                post: {
                    id: postId,
                    version: 0,
                    channelVersion: 0,
                    author: authorModel,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Post content", isHighlighted: false}],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "Post",
                id: postId,
                title: "Post Announcement",
                titleMatch: [{length: 17}],
                body: "Post content",
                bodyMatch: [{length: 12}],
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
                type: "Post",
                title: null,
                post: {
                    id: postId,
                    version: 0,
                    channelVersion: 0,
                    author: authorModel,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "Post",
                id: postId,
                title: "Unknown post",
                titleMatch: [{length: 12}],
                body: null,
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
                type: "PostComment",
                title: null,
                comment: {
                    postId,
                    index: commentIndex,
                    author: authorModel,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Nice post!", isHighlighted: true}],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "PostMessage",
                id: postId,
                index: commentIndex,
                title: null,
                titleMatch: null,
                body: "Nice post!",
                bodyMatch: [{length: 10, isMatch: true}],
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
                type: "Task",
                title: "Fix the bug",
                task: {
                    id: taskId,
                    titleSnapshot: emptyTaskTitleModel.get().getSnapshot(),
                    displayStatus: {
                        value: "OpenInactive",
                        version: [0, 0],
                    },
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Task description", isHighlighted: false}],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "Task",
                id: taskId,
                title: "Fix the bug",
                titleMatch: [{length: 11}],
                body: "Task description",
                bodyMatch: [{length: 16}],
                status: {type: "Open", isActive: false},
            });
        });

        test("converts Task entity with OpenActive status to API result", () => {
            const taskId = generateId<TaskId>();
            const model = new SearchEntityModel({
                type: "Task",
                title: "Implement feature",
                task: {
                    id: taskId,
                    titleSnapshot: emptyTaskTitleModel.get().getSnapshot(),
                    displayStatus: {
                        value: "OpenActive",
                        version: [0, 0],
                    },
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "Task",
                id: taskId,
                title: "Implement feature",
                titleMatch: [{length: 17}],
                body: null,
                bodyMatch: null,
                status: {type: "Open", isActive: true},
            });
        });

        test("converts Task entity with Closed status to API result", () => {
            const taskId = generateId<TaskId>();
            const model = new SearchEntityModel({
                type: "Task",
                title: "Completed task",
                task: {
                    id: taskId,
                    titleSnapshot: emptyTaskTitleModel.get().getSnapshot(),
                    displayStatus: {
                        value: "Closed",
                        version: [0, 0],
                    },
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "Task",
                id: taskId,
                title: "Completed task",
                titleMatch: [{length: 14}],
                body: null,
                bodyMatch: null,
                status: {type: "Closed"},
            });
        });

        test("handles Task with null title", () => {
            const taskId = generateId<TaskId>();
            const model = new SearchEntityModel({
                type: "Task",
                title: null,
                task: {
                    id: taskId,
                    titleSnapshot: emptyTaskTitleModel.get().getSnapshot(),
                    displayStatus: {
                        value: "OpenActive",
                        version: [0, 0],
                    },
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "Task",
                id: taskId,
                title: "Unknown task",
                titleMatch: [{length: 12}],
                body: null,
                bodyMatch: null,
                status: {type: "Open", isActive: true},
            });
        });
    });

    describe("TaskCollection", () => {
        test("converts TaskCollection entity to API result", () => {
            const collectionId = generateId<TaskCollectionId>();
            const model = new SearchEntityModel({
                type: "TaskCollection",
                title: "Sprint 1 Tasks",
                collection: {
                    id: collectionId,
                    titleVersion: [0, 0],
                    color: {
                        value: null,
                        version: [0, 0],
                    },
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "TaskCollection",
                id: collectionId,
                title: "Sprint 1 Tasks",
                titleMatch: [{length: 14}],
                body: null,
                bodyMatch: null,
            });
        });

        test("handles TaskCollection with null title", () => {
            const collectionId = generateId<TaskCollectionId>();
            const model = new SearchEntityModel({
                type: "TaskCollection",
                title: null,
                collection: {
                    id: collectionId,
                    titleVersion: [0, 0],
                    color: {
                        value: null,
                        version: [0, 0],
                    },
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "TaskCollection",
                id: collectionId,
                title: "Unknown task collection",
                titleMatch: [{length: 23}],
                body: null,
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
                type: "TaskComment",
                title: null,
                comment: {
                    taskId,
                    index: commentIndex,
                    author: authorModel,
                },
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [{text: "Working on it", isHighlighted: true}],
                    parsedFilter: null,
                }),
            );

            expect(result).toEqual({
                type: "TaskMessage",
                id: taskId,
                index: commentIndex,
                title: null,
                titleMatch: null,
                body: "Working on it",
                bodyMatch: [{length: 13, isMatch: true}],
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
                type: "Static",
                id: "TaskPersonal",
                title: "My Tasks",
            });

            const result = intoApiSearchResult(
                new SearchEntityResultModel({
                    model,
                    score: 1.0,
                    bodyTextSnippet: [],
                    parsedFilter: null,
                }),
            );

            expect(result).toBeNull();
        });
    });
});
