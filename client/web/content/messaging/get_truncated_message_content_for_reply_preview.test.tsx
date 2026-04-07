import {ReactElement, ReactNode, isValidElement} from "react";
import {getAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {getFileRegistry} from "~/client/web/content/file_registry_context.js";
import {getTruncatedMessageContentForReplyPreview} from "~/client/web/content/messaging/get_truncated_message_content_for_reply_preview.js";
import {getSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {ChatMessageModel} from "~/shared/chat/chat_model.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {FileModel} from "~/shared/files/file_model.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {ChatId, FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {emptyReactionSet} from "~/shared/reactions/reaction_set.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";
import {Store} from "~/shared/store/store.js";

/**
 * Extract text content from a ReactNode. The function returns either a plain
 * string (for file-only messages) or an array of React fragments (for text
 * content).
 */
function extractTextFromReactNode(node: ReactNode): string {
    if (typeof node === "string") return node;
    if (node === null || node === undefined) return "";

    if (Array.isArray(node)) {
        return node.map(extractTextFromReactNode).join("");
    }

    if (isValidElement(node)) {
        const element = node as ReactElement<{children?: ReactNode}>;
        return extractTextFromReactNode(element.props.children);
    }

    return String(node);
}

const spaceId = generateId<SpaceId>();
const chatId = generateId<ChatId>();
const account = createTestAccountModel({name: "Test User"});
const accountRegistry = getAccountRegistry(spaceId);
const searchEntityRegistry = getSearchEntityRegistry(spaceId);
const fileRegistry = getFileRegistry(spaceId);

function get<Value>(store: Store<Value>): Value {
    return store.getSnapshot();
}

function createTestFile(contentType: string): {
    type: "File";
    signedUrlSearch: string;
    file: FileModel;
} {
    return {
        type: "File",
        signedUrlSearch: "",
        file: new FileModel({
            id: generateChronologicalId<FileId>(),
            spaceId,
            contentType: contentType as any,
            contentLength: 100,
            isUploading: false,
            alternative: null,
            preview: null,
        }),
    };
}

function createTestMessage(
    options: {
        content?: string;
        files?: Array<{type: "File"; signedUrlSearch: string; file: FileModel}>;
        isDeleted?: boolean;
    } = {},
): ChatMessageModel {
    const {content = "", files = [], isDeleted = false} = options;

    if (isDeleted) {
        return new ChatMessageModel({
            chatId,
            index: 0,
            version: 0,
            author: account,
            createdTime: new Date(),
            createdTimeZone: defaultTimeZone,
            payload: {
                type: "Deleted",
                deletedTime: new Date(),
            },
            stream: null,
        });
    }

    return new ChatMessageModel({
        chatId,
        index: 0,
        version: 0,
        author: account,
        createdTime: new Date(),
        createdTimeZone: defaultTimeZone,
        payload: {
            type: "Content",
            parent: null,
            content: {
                doc: createSimpleMessageContent(content),
                references: emptyContentReferences,
            },
            contentUpdate: null,
            files,
            reactionsByPos: emptyMap,
            filesReactions: emptyReactionSet,
        },
        stream: null,
    });
}

describe("getTruncatedMessageContentForReplyPreview", () => {
    describe("messages with text content", () => {
        test("returns text content for messages with text", () => {
            const message = createTestMessage({content: "Hello world"});

            const result = getTruncatedMessageContentForReplyPreview(get, {
                message,
                messageNoun: "message",
                accountRegistry,
                searchEntityRegistry,
                fileRegistry,
            });

            expect(extractTextFromReactNode(result)).toEqual("Hello world");
        });

        test("returns text content when message has both text and files", () => {
            const message = createTestMessage({
                content: "Check out these images",
                files: [createTestFile("image/png"), createTestFile("image/jpeg")],
            });

            const result = getTruncatedMessageContentForReplyPreview(get, {
                message,
                messageNoun: "message",
                accountRegistry,
                searchEntityRegistry,
                fileRegistry,
            });

            expect(extractTextFromReactNode(result)).toEqual("Check out these images");
        });
    });

    describe("file-only messages", () => {
        const singleFileTestCases: Array<{
            mimeTypes: Array<string>;
            expected: string;
        }> = [
            {mimeTypes: ["image/png"], expected: "Image"},
            {mimeTypes: ["image/jpeg"], expected: "Image"},
            {mimeTypes: ["image/gif"], expected: "Image"},
            {mimeTypes: ["video/mp4"], expected: "Video"},
            {mimeTypes: ["video/webm"], expected: "Video"},
            {mimeTypes: ["audio/mpeg"], expected: "Audio"},
            {mimeTypes: ["audio/wav"], expected: "Audio"},
            {mimeTypes: ["application/pdf"], expected: "File"},
            {mimeTypes: ["application/octet-stream"], expected: "File"},
        ];

        test.each(singleFileTestCases)(
            "returns $expected for single file with mime type $mimeTypes",
            ({mimeTypes, expected}) => {
                const message = createTestMessage({
                    files: mimeTypes.map(mimeType => createTestFile(mimeType)),
                });

                const result = getTruncatedMessageContentForReplyPreview(get, {
                    message,
                    messageNoun: "message",
                    accountRegistry,
                    searchEntityRegistry,
                    fileRegistry,
                });

                expect(result).toEqual(expected);
            },
        );

        const multipleFileTestCases: Array<{
            mimeTypes: Array<string>;
            expected: string;
        }> = [
            {
                mimeTypes: ["image/png", "image/jpeg", "image/gif"],
                expected: "Image. Image 2. Image 3",
            },
            {
                mimeTypes: ["video/mp4", "video/webm"],
                expected: "Video. Video 2",
            },
            {
                mimeTypes: ["image/png", "video/mp4"],
                expected: "Image. Video",
            },
            {
                mimeTypes: [
                    "image/png",
                    "image/jpeg",
                    "video/mp4",
                    "video/webm",
                    "application/pdf",
                ],
                expected: "Image. Image 2. Video. Video 2. File",
            },
            {
                mimeTypes: ["application/pdf", "application/pdf", "application/pdf"],
                expected: "File. File 2. File 3",
            },
            {
                mimeTypes: ["audio/mpeg", "audio/wav", "image/png"],
                expected: "Audio. Audio 2. Image",
            },
            {
                mimeTypes: [
                    "audio/mpeg",
                    "audio/wav",
                    "image/png",
                    "audio/wav",
                    "image/png",
                    "image/png",
                ],
                expected: "Audio. Audio 2. Image. Audio. Image. Image 2",
            },
        ];

        test.each(multipleFileTestCases)(
            "returns $expected for files with mime types $mimeTypes",
            ({mimeTypes, expected}) => {
                const message = createTestMessage({
                    files: mimeTypes.map(mimeType => createTestFile(mimeType)),
                });

                const result = getTruncatedMessageContentForReplyPreview(get, {
                    message,
                    messageNoun: "message",
                    accountRegistry,
                    searchEntityRegistry,
                    fileRegistry,
                });

                expect(result).toEqual(expected);
            },
        );
    });

    describe("deleted messages", () => {
        test("returns deleted message placeholder for deleted messages", () => {
            const message = createTestMessage({isDeleted: true});

            const result = getTruncatedMessageContentForReplyPreview(get, {
                message,
                messageNoun: "message",
                accountRegistry,
                searchEntityRegistry,
                fileRegistry,
            });

            expect(extractTextFromReactNode(result)).toEqual("Deleted message");
        });

        test("returns deleted comment placeholder when messageNoun is comment", () => {
            const message = createTestMessage({isDeleted: true});

            const result = getTruncatedMessageContentForReplyPreview(get, {
                message,
                messageNoun: "comment",
                accountRegistry,
                searchEntityRegistry,
                fileRegistry,
            });

            expect(extractTextFromReactNode(result)).toEqual("Deleted comment");
        });
    });
});
