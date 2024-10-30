import {InvalidArgumentError} from "~/shared/error/error.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {decodeIdInto, encodeId, idByteLength} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostDraftId,
    PostId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Files may be attached to various entities in our system. A file may be
 * attached to zero, one, or many entities. You can attach one file to multiple
 * entities by copy/pasting it.
 *
 * This type represents the target of an attachment. You can think of a file
 * attachment as a link of `source -> target` where "source" is the file and
 * "target" is the entity the file is attached to.
 */
export type FileAttachmentTarget = FileAttachmentTargetByArea[keyof FileAttachmentTargetByArea];

// TODO(calebmer, #files): Integration test for uploading and viewing all of
// these attachment targets.
export type FileAttachmentTargetByArea = {
    // TODO(calebmer, #files): Implement attachments
    Chat: {readonly type: "ChatMessage"; readonly chatId: ChatId; readonly messageIndex: number};
    // TODO(calebmer, #files): Implement attachments
    Channel: {readonly type: "ChannelDescription"; readonly channelId: ChannelId};
    Document:
        | {readonly type: "Document"; readonly documentId: DocumentId}
        // TODO(calebmer, #files): Implement attachments
        | {
              readonly type: "DocumentComment";
              readonly documentId: DocumentId;
              readonly commentThreadId: DocumentCommentThreadId;
              readonly commentIndex: number;
          };
    Post:
        | {readonly type: "Post"; readonly postId: PostId}
        | {readonly type: "PostDraft"; readonly accountId: AccountId; readonly draftId: PostDraftId}
        // TODO(calebmer, #files): Implement attachments
        | {readonly type: "PostComment"; readonly postId: PostId; readonly commentIndex: number};
    Task:
        | {readonly type: "TaskNotes"; readonly taskId: TaskId}
        // TODO(calebmer, #files): Implement attachments
        | {readonly type: "TaskComment"; readonly taskId: TaskId; readonly commentIndex: number};
};

export const FileAttachmentTargetSchema: Schema<FileAttachmentTarget> = Schema.union({
    ChatMessage: Schema.object({
        type: Schema.value("ChatMessage"),
        chatId: Schema.id<ChatId>(),
        messageIndex: Schema.integer,
    }),
    ChannelDescription: Schema.object({
        type: Schema.value("ChannelDescription"),
        channelId: Schema.id<ChannelId>(),
    }),
    Document: Schema.object({
        type: Schema.value("Document"),
        documentId: Schema.id<DocumentId>(),
    }),
    DocumentComment: Schema.object({
        type: Schema.value("DocumentComment"),
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        commentIndex: Schema.integer,
    }),
    Post: Schema.object({
        type: Schema.value("Post"),
        postId: Schema.id<PostId>(),
    }),
    PostDraft: Schema.object({
        type: Schema.value("PostDraft"),
        accountId: Schema.id<AccountId>(),
        draftId: Schema.id<PostDraftId>(),
    }),
    PostComment: Schema.object({
        type: Schema.value("PostComment"),
        postId: Schema.id<PostId>(),
        commentIndex: Schema.integer,
    }),
    TaskNotes: Schema.object({
        type: Schema.value("TaskNotes"),
        taskId: Schema.id<TaskId>(),
    }),
    TaskComment: Schema.object({
        type: Schema.value("TaskComment"),
        taskId: Schema.id<TaskId>(),
        commentIndex: Schema.integer,
    }),
});

export function serializeFileAttachmentTargetString(target: FileAttachmentTarget): string {
    const bytes = serializeFileAttachmentTargetBytes(target);
    return encodeBase64(bytes, "Rfc4648Url");
}

export function deserializeFileAttachmentTargetString(targetString: string): FileAttachmentTarget {
    const bytes = decodeBase64(targetString, "Rfc4648Url");
    return deserializeFileAttachmentTargetBytes(bytes);
}

function serializeFileAttachmentTargetBytes(target: FileAttachmentTarget): Uint8Array {
    switch (target.type) {
        case "ChatMessage": {
            const bytes = new Uint8Array(1 + idByteLength + 8);
            let byteOffset = 0;

            bytes[byteOffset] = 1;
            byteOffset += 1;

            decodeIdInto(target.chatId, bytes, byteOffset);
            byteOffset += idByteLength;

            new DataView(bytes.buffer).setBigInt64(byteOffset, BigInt(target.messageIndex));
            byteOffset += 8;

            return bytes;
        }
        case "ChannelDescription": {
            const bytes = new Uint8Array(1 + idByteLength);
            let byteOffset = 0;

            bytes[byteOffset] = 2;
            byteOffset += 1;

            decodeIdInto(target.channelId, bytes, byteOffset);
            byteOffset += idByteLength;

            return bytes;
        }
        case "Document": {
            const bytes = new Uint8Array(1 + idByteLength);
            let byteOffset = 0;

            bytes[byteOffset] = 3;
            byteOffset += 1;

            decodeIdInto(target.documentId, bytes, byteOffset);
            byteOffset += idByteLength;

            return bytes;
        }
        case "DocumentComment": {
            const bytes = new Uint8Array(1 + idByteLength + idByteLength + 8);
            let byteOffset = 0;

            bytes[byteOffset] = 4;
            byteOffset += 1;

            decodeIdInto(target.documentId, bytes, byteOffset);
            byteOffset += idByteLength;

            decodeIdInto(target.commentThreadId, bytes, byteOffset);
            byteOffset += idByteLength;

            new DataView(bytes.buffer).setBigInt64(byteOffset, BigInt(target.commentIndex));
            byteOffset += 8;

            return bytes;
        }
        case "Post": {
            const bytes = new Uint8Array(1 + idByteLength);
            let byteOffset = 0;

            bytes[byteOffset] = 5;
            byteOffset += 1;

            decodeIdInto(target.postId, bytes, byteOffset);
            byteOffset += idByteLength;

            return bytes;
        }
        case "PostDraft": {
            const bytes = new Uint8Array(1 + idByteLength);
            let byteOffset = 0;

            bytes[byteOffset] = 6;
            byteOffset += 1;

            decodeIdInto(target.accountId, bytes, byteOffset);
            byteOffset += idByteLength;

            decodeIdInto(target.draftId, bytes, byteOffset);
            byteOffset += idByteLength;

            return bytes;
        }
        case "PostComment": {
            const bytes = new Uint8Array(1 + idByteLength + 8);
            let byteOffset = 0;

            bytes[byteOffset] = 7;
            byteOffset += 1;

            decodeIdInto(target.postId, bytes, byteOffset);
            byteOffset += idByteLength;

            new DataView(bytes.buffer).setBigInt64(byteOffset, BigInt(target.commentIndex));
            byteOffset += 8;

            return bytes;
        }
        case "TaskNotes": {
            const bytes = new Uint8Array(1 + idByteLength);
            let byteOffset = 0;

            bytes[byteOffset] = 8;
            byteOffset += 1;

            decodeIdInto(target.taskId, bytes, byteOffset);
            byteOffset += idByteLength;

            return bytes;
        }
        case "TaskComment": {
            const bytes = new Uint8Array(1 + idByteLength + 8);
            let byteOffset = 0;

            bytes[byteOffset] = 9;
            byteOffset += 1;

            decodeIdInto(target.taskId, bytes, byteOffset);
            byteOffset += idByteLength;

            new DataView(bytes.buffer).setBigInt64(byteOffset, BigInt(target.commentIndex));
            byteOffset += 8;

            return bytes;
        }
        default:
            throw exhaustive(target);
    }
}

function deserializeFileAttachmentTargetBytes(bytes: Uint8Array): FileAttachmentTarget {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let byteOffset = 0;

    const firstByte = bytes[0];
    byteOffset += 1;
    if (firstByte === undefined) throw new InvalidArgumentError("Empty bytes");

    switch (firstByte) {
        case 1: {
            const chatId = encodeId<ChatId>(bytes, byteOffset);
            byteOffset += idByteLength;

            const messageIndex = Number(view.getBigInt64(byteOffset));
            byteOffset += 8;

            return {type: "ChatMessage", chatId, messageIndex};
        }
        case 2: {
            const channelId = encodeId<ChannelId>(bytes, byteOffset);
            byteOffset += idByteLength;

            return {type: "ChannelDescription", channelId};
        }
        case 3: {
            const documentId = encodeId<DocumentId>(bytes, byteOffset);
            byteOffset += idByteLength;

            return {type: "Document", documentId};
        }
        case 4: {
            const documentId = encodeId<DocumentId>(bytes, byteOffset);
            byteOffset += idByteLength;

            const commentThreadId = encodeId<DocumentCommentThreadId>(bytes, byteOffset);
            byteOffset += idByteLength;

            const commentIndex = Number(view.getBigInt64(byteOffset));
            byteOffset += 8;

            return {type: "DocumentComment", documentId, commentThreadId, commentIndex};
        }
        case 5: {
            const postId = encodeId<PostId>(bytes, byteOffset);
            byteOffset += idByteLength;

            return {type: "Post", postId};
        }
        case 6: {
            const accountId = encodeId<AccountId>(bytes, byteOffset);
            byteOffset += idByteLength;

            const draftId = encodeId<PostDraftId>(bytes, byteOffset);
            byteOffset += idByteLength;

            return {type: "PostDraft", accountId, draftId};
        }
        case 7: {
            const postId = encodeId<PostId>(bytes, byteOffset);
            byteOffset += idByteLength;

            const commentIndex = Number(view.getBigInt64(byteOffset));
            byteOffset += 8;

            return {type: "PostComment", postId, commentIndex};
        }
        case 8: {
            const taskId = encodeId<TaskId>(bytes, byteOffset);
            byteOffset += idByteLength;

            return {type: "TaskNotes", taskId};
        }
        case 9: {
            const taskId = encodeId<TaskId>(bytes, byteOffset);
            byteOffset += idByteLength;

            const commentIndex = Number(view.getBigInt64(byteOffset));
            byteOffset += 8;

            return {type: "TaskComment", taskId, commentIndex};
        }
        default:
            throw new InvalidArgumentError(quote`Invalid first byte: ${firstByte}`);
    }
}
