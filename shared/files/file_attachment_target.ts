import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {decodeIdInto, encodeId, idByteLength} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    ChatId,
    DocumentId,
    PostDraftId,
    PostId,
    SpaceId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Files may be attached to various entities in our system. A file may be attached
 * to zero, one, or many entities. You can attach one file to multiple entities by
 * copy/pasting it.
 *
 * This type represents the target of an attachment. You can think of a file
 * attachment as a link of `source -> target` where "source" is the file and
 * "target" is the entity the file is attached to.
 */
export type FileAttachmentTarget = FileAttachmentTargetByArea[keyof FileAttachmentTargetByArea];

export type FileAttachmentTargetByArea = {
    Chat: {readonly type: "ChatMessages"; readonly chatId: ChatId};
    Document:
        | {readonly type: "Document"; readonly documentId: DocumentId}
        | {readonly type: "DocumentComments"; readonly documentId: DocumentId};
    Post:
        | {readonly type: "Post"; readonly postId: PostId}
        | {
              readonly type: "PostDraft";
              readonly spaceId: SpaceId;
              readonly accountId: AccountId;
              readonly draftId: PostDraftId;
          }
        | {readonly type: "PostComments"; readonly postId: PostId};
    Task:
        | {readonly type: "TaskNotes"; readonly taskId: TaskId}
        | {readonly type: "TaskComments"; readonly taskId: TaskId};
};

export const FileAttachmentTargetSchema: Schema<FileAttachmentTarget> = Schema.union({
    ChatMessages: Schema.object({
        type: Schema.value("ChatMessages"),
        chatId: Schema.id<ChatId>(),
    }),
    Document: Schema.object({
        type: Schema.value("Document"),
        documentId: Schema.id<DocumentId>(),
    }),
    DocumentComments: Schema.object({
        type: Schema.value("DocumentComments"),
        documentId: Schema.id<DocumentId>(),
    }),
    Post: Schema.object({
        type: Schema.value("Post"),
        postId: Schema.id<PostId>(),
    }),
    PostDraft: Schema.object({
        type: Schema.value("PostDraft"),
        spaceId: Schema.id<SpaceId>(),
        accountId: Schema.id<AccountId>(),
        draftId: Schema.id<PostDraftId>(),
    }),
    PostComments: Schema.object({
        type: Schema.value("PostComments"),
        postId: Schema.id<PostId>(),
    }),
    TaskNotes: Schema.object({
        type: Schema.value("TaskNotes"),
        taskId: Schema.id<TaskId>(),
    }),
    TaskComments: Schema.object({
        type: Schema.value("TaskComments"),
        taskId: Schema.id<TaskId>(),
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
        case "ChatMessages": {
            const bytes = new Uint8Array(1 + idByteLength + 8);
            let byteOffset = 0;

            bytes[byteOffset] = 1;
            byteOffset += 1;

            decodeIdInto(target.chatId, bytes, byteOffset);
            byteOffset += idByteLength;

            return bytes;
        }
        case "Document": {
            const bytes = new Uint8Array(1 + idByteLength);
            let byteOffset = 0;

            // NOTE(calebmer): We skip 2 because I used to have a `ChannelDescription` file
            // attachment target which used 2 as the sentinel byte. But after deciding
            // `MessageContent` wouldn't support inline files I deleted the
            // `ChannelDescription` attachment target since it won't be used.
            bytes[byteOffset] = 3;
            byteOffset += 1;

            decodeIdInto(target.documentId, bytes, byteOffset);
            byteOffset += idByteLength;

            return bytes;
        }
        case "DocumentComments": {
            const bytes = new Uint8Array(1 + idByteLength + idByteLength + 8);
            let byteOffset = 0;

            bytes[byteOffset] = 4;
            byteOffset += 1;

            decodeIdInto(target.documentId, bytes, byteOffset);
            byteOffset += idByteLength;

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
            const bytes = new Uint8Array(1 + idByteLength + idByteLength + idByteLength);
            let byteOffset = 0;

            bytes[byteOffset] = 6;
            byteOffset += 1;

            decodeIdInto(target.spaceId, bytes, byteOffset);
            byteOffset += idByteLength;

            decodeIdInto(target.accountId, bytes, byteOffset);
            byteOffset += idByteLength;

            decodeIdInto(target.draftId, bytes, byteOffset);
            byteOffset += idByteLength;

            return bytes;
        }
        case "PostComments": {
            const bytes = new Uint8Array(1 + idByteLength + 8);
            let byteOffset = 0;

            bytes[byteOffset] = 7;
            byteOffset += 1;

            decodeIdInto(target.postId, bytes, byteOffset);
            byteOffset += idByteLength;

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
        case "TaskComments": {
            const bytes = new Uint8Array(1 + idByteLength + 8);
            let byteOffset = 0;

            bytes[byteOffset] = 9;
            byteOffset += 1;

            decodeIdInto(target.taskId, bytes, byteOffset);
            byteOffset += idByteLength;

            return bytes;
        }
        default:
            throw exhaustive(target);
    }
}

function deserializeFileAttachmentTargetBytes(bytes: Uint8Array): FileAttachmentTarget {
    let byteOffset = 0;

    const firstByte = bytes[0];
    byteOffset += 1;
    if (firstByte === undefined) throw new InvalidArgumentError("Empty bytes");

    switch (firstByte) {
        case 1: {
            const chatId = encodeId<ChatId>(bytes, byteOffset);
            byteOffset += idByteLength;

            return {type: "ChatMessages", chatId};
        }
        case 3: {
            const documentId = encodeId<DocumentId>(bytes, byteOffset);
            byteOffset += idByteLength;

            return {type: "Document", documentId};
        }
        case 4: {
            const documentId = encodeId<DocumentId>(bytes, byteOffset);
            byteOffset += idByteLength;

            return {type: "DocumentComments", documentId};
        }
        case 5: {
            const postId = encodeId<PostId>(bytes, byteOffset);
            byteOffset += idByteLength;

            return {type: "Post", postId};
        }
        case 6: {
            const spaceId = encodeId<SpaceId>(bytes, byteOffset);
            byteOffset += idByteLength;

            const accountId = encodeId<AccountId>(bytes, byteOffset);
            byteOffset += idByteLength;

            const draftId = encodeId<PostDraftId>(bytes, byteOffset);
            byteOffset += idByteLength;

            return {type: "PostDraft", spaceId, accountId, draftId};
        }
        case 7: {
            const postId = encodeId<PostId>(bytes, byteOffset);
            byteOffset += idByteLength;

            return {type: "PostComments", postId};
        }
        case 8: {
            const taskId = encodeId<TaskId>(bytes, byteOffset);
            byteOffset += idByteLength;

            return {type: "TaskNotes", taskId};
        }
        case 9: {
            const taskId = encodeId<TaskId>(bytes, byteOffset);
            byteOffset += idByteLength;

            return {type: "TaskComments", taskId};
        }
        default:
            throw new InvalidArgumentError(quote`Invalid first byte: ${firstByte}`);
    }
}
