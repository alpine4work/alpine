import {
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskId,
} from "~/shared/id/types/id_types.js";

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

export type FileAttachmentTargetByArea = {
    Chat: {readonly type: "ChatMessage"; readonly chatId: ChatId; readonly messageIndex: number};
    Channel: {readonly type: "ChannelDescription"; readonly channelId: ChannelId};
    Document:
        | {readonly type: "Document"; readonly documentId: DocumentId}
        | {
              readonly type: "DocumentComment";
              readonly documentId: DocumentId;
              readonly commentThreadId: DocumentCommentThreadId;
              readonly commentIndex: number;
          };
    Post:
        | {readonly type: "Post"; readonly postId: PostId}
        | {readonly type: "PostComment"; readonly postId: PostId; readonly commentIndex: number};
    Task:
        | {readonly type: "TaskNotes"; readonly taskId: TaskId}
        | {readonly type: "TaskComment"; readonly taskId: TaskId; readonly commentIndex: number};
};
