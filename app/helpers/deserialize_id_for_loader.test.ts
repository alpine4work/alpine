import {
    deserializeAccountIdForLoader,
    deserializeChannelIdForLoader,
    deserializeChatIdForLoader,
    deserializeDocumentIdForLoader,
    deserializePostIdForLoader,
    deserializeSpaceIdForLoader,
    deserializeTaskIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentId,
    PostId,
    SpaceId,
    TaskId,
} from "~/shared/id/types/id_types.js";

// These assignments would fail at compile time if types were incorrect
// We use a valid ID here so the code doesn't throw at module initialization
const testTypeId = generateId();
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const accountId: AccountId = deserializeAccountIdForLoader(testTypeId);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const documentId: DocumentId = deserializeDocumentIdForLoader(testTypeId);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const channelId: ChannelId = deserializeChannelIdForLoader(testTypeId);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const chatId: ChatId = deserializeChatIdForLoader(testTypeId);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const taskId: TaskId = deserializeTaskIdForLoader(testTypeId);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const postId: PostId = deserializePostIdForLoader(testTypeId);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const spaceId: SpaceId = deserializeSpaceIdForLoader(testTypeId);

describe("ID deserializers", () => {
    const validId = generateId();

    describe("successful deserialization", () => {
        test("deserializeAccountIdForLoader deserializes valid Account ID", () => {
            const result = deserializeAccountIdForLoader(validId);
            expect(result).toBe(validId);
        });

        test("deserializeDocumentIdForLoader deserializes valid Document ID", () => {
            const result = deserializeDocumentIdForLoader(validId);
            expect(result).toBe(validId);
        });

        test("deserializeChannelIdForLoader deserializes valid Channel ID", () => {
            const result = deserializeChannelIdForLoader(validId);
            expect(result).toBe(validId);
        });

        test("deserializeChatIdForLoader deserializes valid Chat ID", () => {
            const result = deserializeChatIdForLoader(validId);
            expect(result).toBe(validId);
        });

        test("deserializeTaskIdForLoader deserializes valid Task ID", () => {
            const result = deserializeTaskIdForLoader(validId);
            expect(result).toBe(validId);
        });

        test("deserializePostIdForLoader deserializes valid Post ID", () => {
            const result = deserializePostIdForLoader(validId);
            expect(result).toBe(validId);
        });

        test("deserializeSpaceIdForLoader deserializes valid Space ID", () => {
            const result = deserializeSpaceIdForLoader(validId);
            expect(result).toBe(validId);
        });
    });

    const testCases = {
        Account: {
            function: deserializeAccountIdForLoader,
            message: "Account not found",
            displayMessage: errorDisplayMessage`This account doesn\u2019t exist.`,
            errorType: NotFoundError,
        },
        Document: {
            function: deserializeDocumentIdForLoader,
            message: "Document not found",
            displayMessage: errorDisplayMessage`This document doesn\u2019t exist. Try searching \u201Cmy documents\u201D to see documents you\u2019ve created.`,
            errorType: NotFoundError,
        },
        Channel: {
            function: deserializeChannelIdForLoader,
            message: "Channel not found",
            displayMessage: errorDisplayMessage`This channel doesn\u2019t exist. Try searching \u201Call channels\u201D to see channels you can access.`,
            errorType: NotFoundError,
        },
        Chat: {
            function: deserializeChatIdForLoader,
            message: "Chat not found",
            displayMessage: errorDisplayMessage`This chat doesn\u2019t exist. Try searching \u201Call chats\u201D to see chats you can access.`,
            errorType: NotFoundError,
        },
        Task: {
            function: deserializeTaskIdForLoader,
            message: "Task not found",
            displayMessage: errorDisplayMessage`This task doesn\u2019t exist. Try searching \u201Cmy tasks\u201D to see tasks you\u2019ve created.`,
            errorType: NotFoundError,
        },
        Post: {
            function: deserializePostIdForLoader,
            message: "Post not found",
            displayMessage: errorDisplayMessage`This post doesn\u2019t exist. Try searching \u201Call posts\u201D to see posts you can access.`,
            errorType: NotFoundError,
        },
        Space: {
            function: deserializeSpaceIdForLoader,
            message: "Account doesn\u2019t have access to space",
            displayMessage: errorDisplayMessage`This space doesn\u2019t exist.`,
            errorType: PermissionDeniedError,
        },
    } as const;

    describe("error handling for invalid inputs", () => {
        const entityTypes = Object.keys(testCases) as Array<keyof typeof testCases>;

        const invalidInputs = [
            {value: null, description: "null"},
            {value: undefined, description: "undefined"},
            {value: "", description: "empty string"},
            {value: "invalid-id", description: "invalid string"},
        ] as const;

        for (const entityType of entityTypes) {
            for (const {value, description} of invalidInputs) {
                test(`throws error for ${entityType} with ${description}`, () => {
                    expect(() => {
                        testCases[entityType].function(value);
                    }).toThrow(testCases[entityType].errorType);
                });
            }
        }
    });

    describe("error message content", () => {
        for (const [
            entityType,
            {function: deserializerFunction, message, displayMessage, errorType},
        ] of Object.entries(testCases)) {
            test(`${entityType} error has correct messages`, () => {
                expect(() => {
                    deserializerFunction(null);
                }).toThrow(
                    new errorType(message, {
                        aggregateDedupeKey: undefined,
                        displayMessage,
                    }),
                );
            });
        }
    });

    describe("aggregate dedupe key", () => {
        test("sets aggregateDedupeKey to undefined for null ID", () => {
            try {
                deserializeAccountIdForLoader(null);
            } catch (error) {
                expect(error).toBeInstanceOf(NotFoundError);
                if (error instanceof NotFoundError) {
                    expect(error.aggregateDedupeKey).toBeUndefined();
                }
            }
        });

        test("sets aggregateDedupeKey to the invalid ID value", () => {
            const invalidId = "invalid-id";
            try {
                deserializeAccountIdForLoader(invalidId);
            } catch (error) {
                expect(error).toBeInstanceOf(NotFoundError);
                if (error instanceof NotFoundError) {
                    expect(error.aggregateDedupeKey).toBe(invalidId);
                }
            }
        });
    });
});
