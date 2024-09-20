import {
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
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
    Post: // TODO(calebmer, #files): Implement attachments
    | {readonly type: "Post"; readonly postId: PostId}
        // TODO(calebmer, #files): Implement attachments
        | {readonly type: "PostComment"; readonly postId: PostId; readonly commentIndex: number};
    Task: // TODO(calebmer, #files): Implement attachments
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
