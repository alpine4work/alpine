import {
    getApiMentionPathIfExists,
    isApiMentionPath,
    parseApiMentionPath,
    parseApiMessageRoomPath,
    parseApiNotMentionPath,
    parseApiPath,
    printApiMentionPath,
    printApiMessageRoomPath,
    printApiPath,
} from "~/shared/api/parse_api_path.js";
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

const accountId = generateId<AccountId>();
const channelId = generateId<ChannelId>();
const chatId = generateId<ChatId>();
const documentId = generateId<DocumentId>();
const documentCommentThreadId = generateId<DocumentCommentThreadId>();
const postId = generateId<PostId>();
const taskId = generateId<TaskId>();
const taskCollectionId = generateId<TaskCollectionId>();

describe("parseApiPath", () => {
    describe("error cases", () => {
        test("throws on path not starting with /", () => {
            expect(() => parseApiPath(`accounts/${accountId}` as any)).toThrow(
                "Path doesn’t start with `/`",
            );
        });

        test("throws on unrecognized path segment", () => {
            expect(() => parseApiPath("/unknown/path" as any)).toThrow(
                "Unrecognized first path segment",
            );
        });

        test("throws on path with less than two path segments", () => {
            expect(() => parseApiPath("/accounts" as any)).toThrow(
                "Path doesn’t have at least two path segments",
            );
        });
    });

    describe("account paths", () => {
        test("parses account path", () => {
            expect(parseApiPath(`/accounts/${accountId}`)).toEqual({
                type: "Account",
                accountId,
            });
        });

        test("throws on invalid account ID", () => {
            expect(() => parseApiPath("/accounts/invalid-id" as any)).toThrow(
                "Second path segment isn’t an `Id`",
            );
        });

        test("throws on extra path segments", () => {
            expect(() => parseApiPath(`/accounts/${accountId}/extra` as any)).toThrow(
                "Expected two path segments",
            );
        });
    });

    describe("channel paths", () => {
        test("parses channel path", () => {
            expect(parseApiPath(`/channels/${channelId}`)).toEqual({
                type: "Channel",
                channelId,
            });
        });

        test("throws on invalid channel ID", () => {
            expect(() => parseApiPath("/channels/invalid-id" as any)).toThrow(
                "Second path segment isn’t an `Id`",
            );
        });

        test("throws on extra path segments", () => {
            expect(() => parseApiPath(`/channels/${channelId}/extra` as any)).toThrow(
                "Expected two path segments",
            );
        });
    });

    describe("chat paths", () => {
        test("parses chat path", () => {
            expect(parseApiPath(`/chats/${chatId}`)).toEqual({
                type: "Chat",
                chatId,
            });
        });

        test("parses chat messages list path", () => {
            expect(parseApiPath(`/chats/${chatId}/messages`)).toEqual({
                type: "ChatMessages",
                chatId,
            });
        });

        test("parses chat message path", () => {
            expect(parseApiPath(`/chats/${chatId}/messages/0`)).toEqual({
                type: "ChatMessage",
                chatId,
                messageIndex: 0,
            });

            expect(parseApiPath(`/chats/${chatId}/messages/42`)).toEqual({
                type: "ChatMessage",
                chatId,
                messageIndex: 42,
            });
        });

        test("throws on invalid chat ID", () => {
            expect(() => parseApiPath("/chats/invalid-id" as any)).toThrow(
                "Second path segment isn’t an `Id`",
            );
        });

        test("throws on invalid message index", () => {
            expect(() => parseApiPath(`/chats/${chatId}/messages/abc` as any)).toThrow(
                "Fourth path segment isn’t a valid message index",
            );
            expect(() => parseApiPath(`/chats/${chatId}/messages/-1` as any)).toThrow(
                "Fourth path segment isn’t a valid message index",
            );
            expect(() => parseApiPath(`/chats/${chatId}/messages/1.5` as any)).toThrow(
                "Fourth path segment isn’t a valid message index",
            );
        });

        test("throws on extra path segments", () => {
            expect(() => parseApiPath(`/chats/${chatId}/messages/0/extra` as any)).toThrow(
                "Expected four path segments",
            );
        });
        test("throws on unexpected path segments", () => {
            expect(() => parseApiPath(`/chats/${chatId}/comments/0` as any)).toThrow(
                "Expected two path segments",
            );
        });
    });

    describe("document paths", () => {
        test("parses document path", () => {
            expect(parseApiPath(`/documents/${documentId}`)).toEqual({
                type: "Document",
                documentId,
            });
        });

        test("parses document comment thread path", () => {
            expect(
                parseApiPath(`/documents/${documentId}/threads/${documentCommentThreadId}`),
            ).toEqual({
                type: "DocumentCommentThread",
                documentId,
                commentThreadId: documentCommentThreadId,
            });
        });

        test("parses document comment thread comments list path", () => {
            expect(
                parseApiPath(
                    `/documents/${documentId}/threads/${documentCommentThreadId}/messages`,
                ),
            ).toEqual({
                type: "DocumentCommentThreadComments",
                documentId,
                commentThreadId: documentCommentThreadId,
            });
        });

        test("parses document comment thread comment path", () => {
            expect(
                parseApiPath(
                    `/documents/${documentId}/threads/${documentCommentThreadId}/messages/0`,
                ),
            ).toEqual({
                type: "DocumentComment",
                documentId,
                commentThreadId: documentCommentThreadId,
                commentIndex: 0,
            });

            expect(
                parseApiPath(
                    `/documents/${documentId}/threads/${documentCommentThreadId}/messages/15`,
                ),
            ).toEqual({
                type: "DocumentComment",
                documentId,
                commentThreadId: documentCommentThreadId,
                commentIndex: 15,
            });
        });

        test("throws on invalid document ID", () => {
            expect(() => parseApiPath("/documents/invalid-id" as any)).toThrow(
                "Second path segment isn’t an `Id`",
            );
        });

        test("throws on invalid thread ID", () => {
            expect(() =>
                parseApiPath(`/documents/${documentId}/threads/invalid-id` as any),
            ).toThrow("Fourth path segment isn’t an `Id`");
        });

        test("throws on invalid comment index", () => {
            expect(() =>
                parseApiPath(
                    `/documents/${documentId}/threads/${documentCommentThreadId}/messages/abc` as any,
                ),
            ).toThrow("Sixth path segment isn’t a valid message index");
            expect(() =>
                parseApiPath(
                    `/documents/${documentId}/threads/${documentCommentThreadId}/messages/-1`,
                ),
            ).toThrow("Sixth path segment isn’t a valid message index");
        });

        test("throws on extra path segments", () => {
            expect(() => parseApiPath(`/documents/${documentId}/extra` as any)).toThrow(
                "Expected two path segments",
            );
            expect(() =>
                parseApiPath(
                    `/documents/${documentId}/threads/${documentCommentThreadId}/extra` as any,
                ),
            ).toThrow("Expected four path segments");
            expect(() =>
                parseApiPath(
                    `/documents/${documentId}/threads/${documentCommentThreadId}/messages/0/extra` as any,
                ),
            ).toThrow("Expected six path segments");
        });
    });

    describe("post paths", () => {
        test("parses post path", () => {
            expect(parseApiPath(`/posts/${postId}`)).toEqual({
                type: "Post",
                postId,
            });
        });

        test("parses post comments list path", () => {
            expect(parseApiPath(`/posts/${postId}/messages`)).toEqual({
                type: "PostComments",
                postId,
            });
        });

        test("parses post comment path", () => {
            expect(parseApiPath(`/posts/${postId}/messages/0`)).toEqual({
                type: "PostComment",
                postId,
                commentIndex: 0,
            });

            expect(parseApiPath(`/posts/${postId}/messages/7`)).toEqual({
                type: "PostComment",
                postId,
                commentIndex: 7,
            });
        });

        test("throws on invalid post ID", () => {
            expect(() => parseApiPath("/posts/invalid-id" as any)).toThrow(
                "Second path segment isn’t an `Id`",
            );
        });

        test("throws on invalid comment index", () => {
            expect(() => parseApiPath(`/posts/${postId}/messages/abc` as any)).toThrow(
                "Fourth path segment isn’t a valid message index",
            );
            expect(() => parseApiPath(`/posts/${postId}/messages/-1`)).toThrow(
                "Fourth path segment isn’t a valid message index",
            );
        });

        test("throws on extra path segments", () => {
            expect(() => parseApiPath(`/posts/${postId}/extra` as any)).toThrow(
                "Expected two path segments",
            );
            expect(() => parseApiPath(`/posts/${postId}/messages/0/extra` as any)).toThrow(
                "Expected four path segments",
            );
        });
    });

    describe("task paths", () => {
        test("parses task path", () => {
            expect(parseApiPath(`/tasks/${taskId}`)).toEqual({
                type: "Task",
                taskId,
            });
        });

        test("parses task comments list path", () => {
            expect(parseApiPath(`/tasks/${taskId}/messages`)).toEqual({
                type: "TaskComments",
                taskId,
            });
        });

        test("parses task comment path", () => {
            expect(parseApiPath(`/tasks/${taskId}/messages/0`)).toEqual({
                type: "TaskComment",
                taskId,
                commentIndex: 0,
            });

            expect(parseApiPath(`/tasks/${taskId}/messages/99`)).toEqual({
                type: "TaskComment",
                taskId,
                commentIndex: 99,
            });
        });

        test("throws on invalid task ID", () => {
            expect(() => parseApiPath("/tasks/invalid-id" as any)).toThrow(
                "Second path segment isn’t an `Id`",
            );
        });

        test("throws on invalid comment index", () => {
            expect(() => parseApiPath(`/tasks/${taskId}/messages/abc` as any)).toThrow(
                "Fourth path segment isn’t a valid message index",
            );
            expect(() => parseApiPath(`/tasks/${taskId}/messages/-1`)).toThrow(
                "Fourth path segment isn’t a valid message index",
            );
        });

        test("throws on extra path segments", () => {
            expect(() => parseApiPath(`/tasks/${taskId}/extra` as any)).toThrow(
                "Expected two path segments",
            );
            expect(() => parseApiPath(`/tasks/${taskId}/messages/0/extra` as any)).toThrow(
                "Expected four path segments",
            );
        });
    });

    describe("task collection paths", () => {
        test("parses task collection path", () => {
            expect(parseApiPath(`/task-collections/${taskCollectionId}`)).toEqual({
                type: "TaskCollection",
                collectionId: taskCollectionId,
            });
        });

        test("throws on invalid task collection ID", () => {
            expect(() => parseApiPath("/task-collections/invalid-id" as any)).toThrow(
                "Second path segment isn’t an `Id`",
            );
        });

        test("throws on extra path segments", () => {
            expect(() =>
                parseApiPath(`/task-collections/${taskCollectionId}/extra` as any),
            ).toThrow("Expected two path segments");
        });
    });
});

describe("printApiPath", () => {
    test("prints account path", () => {
        expect(printApiPath({type: "Account", accountId})).toEqual(`/accounts/${accountId}`);
    });

    test("prints channel path", () => {
        expect(printApiPath({type: "Channel", channelId})).toEqual(`/channels/${channelId}`);
    });

    test("prints chat path", () => {
        expect(printApiPath({type: "Chat", chatId})).toEqual(`/chats/${chatId}`);
    });

    test("prints chat messages list path", () => {
        expect(printApiPath({type: "ChatMessages", chatId})).toEqual(`/chats/${chatId}/messages`);
    });

    test("prints chat message path", () => {
        expect(printApiPath({type: "ChatMessage", chatId, messageIndex: 5})).toEqual(
            `/chats/${chatId}/messages/5`,
        );
    });

    test("prints document path", () => {
        expect(printApiPath({type: "Document", documentId})).toEqual(`/documents/${documentId}`);
    });

    test("prints document comment thread path", () => {
        expect(
            printApiPath({
                type: "DocumentCommentThread",
                documentId,
                commentThreadId: documentCommentThreadId,
            }),
        ).toEqual(`/documents/${documentId}/threads/${documentCommentThreadId}`);
    });

    test("prints document comment thread comments list path", () => {
        expect(
            printApiPath({
                type: "DocumentCommentThreadComments",
                documentId,
                commentThreadId: documentCommentThreadId,
            }),
        ).toEqual(`/documents/${documentId}/threads/${documentCommentThreadId}/messages`);
    });

    test("prints document comment thread comment path", () => {
        expect(
            printApiPath({
                type: "DocumentComment",
                documentId,
                commentThreadId: documentCommentThreadId,
                commentIndex: 3,
            }),
        ).toEqual(`/documents/${documentId}/threads/${documentCommentThreadId}/messages/3`);
    });

    test("prints post path", () => {
        expect(printApiPath({type: "Post", postId})).toEqual(`/posts/${postId}`);
    });

    test("prints post comments list path", () => {
        expect(printApiPath({type: "PostComments", postId})).toEqual(`/posts/${postId}/messages`);
    });

    test("prints post comment path", () => {
        expect(printApiPath({type: "PostComment", postId, commentIndex: 2})).toEqual(
            `/posts/${postId}/messages/2`,
        );
    });

    test("prints task path", () => {
        expect(printApiPath({type: "Task", taskId})).toEqual(`/tasks/${taskId}`);
    });

    test("prints task comments list path", () => {
        expect(printApiPath({type: "TaskComments", taskId})).toEqual(`/tasks/${taskId}/messages`);
    });

    test("prints task comment path", () => {
        expect(printApiPath({type: "TaskComment", taskId, commentIndex: 10})).toEqual(
            `/tasks/${taskId}/messages/10`,
        );
    });

    test("prints task collection path", () => {
        expect(printApiPath({type: "TaskCollection", collectionId: taskCollectionId})).toEqual(
            `/task-collections/${taskCollectionId}`,
        );
    });
});

describe("parseApiMessageRoomPath", () => {
    test("parses chat path", () => {
        expect(parseApiMessageRoomPath(`/chats/${chatId}`)).toEqual({
            type: "Chat",
            chatId,
        });
    });

    test("parses channel path", () => {
        expect(parseApiMessageRoomPath(`/channels/${channelId}` as any)).toEqual({
            type: "Channel",
            channelId,
        });
    });

    test("parses document comment thread path", () => {
        expect(
            parseApiMessageRoomPath(`/documents/${documentId}/threads/${documentCommentThreadId}`),
        ).toEqual({
            type: "DocumentCommentThread",
            documentId,
            commentThreadId: documentCommentThreadId,
        });
    });
});

describe("printApiMessageRoomPath", () => {
    test("prints chat path", () => {
        expect(printApiMessageRoomPath({type: "Chat", chatId})).toEqual(`/chats/${chatId}`);
    });

    test("prints document comment thread path", () => {
        expect(
            printApiMessageRoomPath({
                type: "DocumentCommentThread",
                documentId,
                commentThreadId: documentCommentThreadId,
            }),
        ).toEqual(`/documents/${documentId}/threads/${documentCommentThreadId}`);
    });

    test("prints post path", () => {
        expect(printApiMessageRoomPath({type: "Post", postId})).toEqual(`/posts/${postId}`);
    });

    test("prints task path", () => {
        expect(printApiMessageRoomPath({type: "Task", taskId})).toEqual(`/tasks/${taskId}`);
    });
});

describe("parseApiContentMentionInlineElementTargetPath", () => {
    test("parses account path", () => {
        expect(parseApiMentionPath(`/accounts/${accountId}`)).toEqual({
            type: "Account",
            accountId,
        });
    });

    test("parses channel path", () => {
        expect(parseApiMentionPath(`/channels/${channelId}`)).toEqual({
            type: "Channel",
            channelId,
        });
    });

    test("parses document path", () => {
        expect(parseApiMentionPath(`/documents/${documentId}`)).toEqual({
            type: "Document",
            documentId,
        });
    });

    test("parses post path", () => {
        expect(parseApiMentionPath(`/posts/${postId}`)).toEqual({
            type: "Post",
            postId,
        });
    });

    test("parses task path", () => {
        expect(parseApiMentionPath(`/tasks/${taskId}`)).toEqual({
            type: "Task",
            taskId,
        });
    });

    test("parses task collection path", () => {
        expect(parseApiMentionPath(`/task-collections/${taskCollectionId}`)).toEqual({
            type: "TaskCollection",
            collectionId: taskCollectionId,
        });
    });
});

describe("printApiContentMentionInlineElementTargetPath", () => {
    test("prints account path", () => {
        expect(printApiMentionPath({type: "Account", accountId})).toEqual(`/accounts/${accountId}`);
    });

    test("prints channel path", () => {
        expect(printApiMentionPath({type: "Channel", channelId})).toEqual(`/channels/${channelId}`);
    });

    test("prints document path", () => {
        expect(printApiMentionPath({type: "Document", documentId})).toEqual(
            `/documents/${documentId}`,
        );
    });

    test("prints post path", () => {
        expect(printApiMentionPath({type: "Post", postId})).toEqual(`/posts/${postId}`);
    });

    test("prints task path", () => {
        expect(printApiMentionPath({type: "Task", taskId})).toEqual(`/tasks/${taskId}`);
    });

    test("prints task collection path", () => {
        expect(
            printApiMentionPath({
                type: "TaskCollection",
                collectionId: taskCollectionId,
            }),
        ).toEqual(`/task-collections/${taskCollectionId}`);
    });
});

describe("parseApiContentNonMentionableElementTargetPath", () => {
    test("parses chat path", () => {
        expect(parseApiNotMentionPath(`/chats/${chatId}`)).toEqual({
            type: "Chat",
            chatId,
        });
    });

    test("parses chat messages list path", () => {
        expect(parseApiNotMentionPath(`/chats/${chatId}/messages`)).toEqual({
            type: "ChatMessages",
            chatId,
        });
    });

    test("parses document comment thread comment path", () => {
        expect(
            parseApiNotMentionPath(
                `/documents/${documentId}/threads/${documentCommentThreadId}/messages/0`,
            ),
        ).toEqual({
            type: "DocumentComment",
            documentId,
            commentThreadId: documentCommentThreadId,
            commentIndex: 0,
        });
    });
});

describe("isApiContentMentionInlineElementTargetPath", () => {
    test("returns true for mentionable paths", () => {
        expect(isApiMentionPath(`/accounts/${accountId}`)).toEqual(true);
        expect(isApiMentionPath(`/channels/${channelId}`)).toEqual(true);
        expect(isApiMentionPath(`/documents/${documentId}`)).toEqual(true);
        expect(isApiMentionPath(`/posts/${postId}`)).toEqual(true);
        expect(isApiMentionPath(`/tasks/${taskId}`)).toEqual(true);
        expect(isApiMentionPath(`/task-collections/${taskCollectionId}`)).toEqual(true);
    });

    test("returns false for non-mentionable paths", () => {
        expect(isApiMentionPath(`/chats/${chatId}`)).toEqual(false);
        expect(isApiMentionPath(`/chats/${chatId}/messages`)).toEqual(false);
        expect(isApiMentionPath(`/chats/${chatId}/messages/0`)).toEqual(false);
        expect(
            isApiMentionPath(`/documents/${documentId}/threads/${documentCommentThreadId}`),
        ).toEqual(false);
        expect(
            isApiMentionPath(
                `/documents/${documentId}/threads/${documentCommentThreadId}/messages`,
            ),
        ).toEqual(false);
        expect(
            isApiMentionPath(
                `/documents/${documentId}/threads/${documentCommentThreadId}/messages/0`,
            ),
        ).toEqual(false);
    });
});

describe("getApiContentMentionInlineElementTargetPathIfExists", () => {
    test("returns path for already mentionable paths", () => {
        expect(getApiMentionPathIfExists(`/accounts/${accountId}`)).toEqual(
            `/accounts/${accountId}`,
        );
        expect(getApiMentionPathIfExists(`/channels/${channelId}`)).toEqual(
            `/channels/${channelId}`,
        );
        expect(getApiMentionPathIfExists(`/documents/${documentId}`)).toEqual(
            `/documents/${documentId}`,
        );
        expect(getApiMentionPathIfExists(`/posts/${postId}`)).toEqual(`/posts/${postId}`);
        expect(getApiMentionPathIfExists(`/tasks/${taskId}`)).toEqual(`/tasks/${taskId}`);
        expect(getApiMentionPathIfExists(`/task-collections/${taskCollectionId}`)).toEqual(
            `/task-collections/${taskCollectionId}`,
        );
    });

    test("returns parent document path for document comment paths", () => {
        expect(
            getApiMentionPathIfExists(
                `/documents/${documentId}/threads/${documentCommentThreadId}`,
            ),
        ).toEqual(`/documents/${documentId}`);
        expect(
            getApiMentionPathIfExists(
                `/documents/${documentId}/threads/${documentCommentThreadId}/messages`,
            ),
        ).toEqual(`/documents/${documentId}`);
        expect(
            getApiMentionPathIfExists(
                `/documents/${documentId}/threads/${documentCommentThreadId}/messages/0`,
            ),
        ).toEqual(`/documents/${documentId}`);
    });

    test("returns parent post path for post comment paths", () => {
        expect(getApiMentionPathIfExists(`/posts/${postId}/messages`)).toEqual(`/posts/${postId}`);
        expect(getApiMentionPathIfExists(`/posts/${postId}/messages/0`)).toEqual(
            `/posts/${postId}`,
        );
    });

    test("returns parent task path for task comment paths", () => {
        expect(getApiMentionPathIfExists(`/tasks/${taskId}/messages`)).toEqual(`/tasks/${taskId}`);
        expect(getApiMentionPathIfExists(`/tasks/${taskId}/messages/0`)).toEqual(
            `/tasks/${taskId}`,
        );
    });

    test("returns null for chat paths", () => {
        expect(getApiMentionPathIfExists(`/chats/${chatId}`)).toEqual(null);
        expect(getApiMentionPathIfExists(`/chats/${chatId}/messages`)).toEqual(null);
        expect(getApiMentionPathIfExists(`/chats/${chatId}/messages/0`)).toEqual(null);
    });
});
