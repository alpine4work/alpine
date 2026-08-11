import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Identifies the entity whose messaging surface a draft belongs to.
 */
export type MessageDraftSurface = SchemaType<typeof MessageDraftSurfaceSchema>;

export const MessageDraftSurfaceSchema = Schema.union({
    Chat: Schema.object({
        type: Schema.value("Chat"),
        chatId: Schema.id<ChatId>(),
    }),
    PostComment: Schema.object({
        type: Schema.value("PostComment"),
        postId: Schema.id<PostId>(),
    }),
    TaskComment: Schema.object({
        type: Schema.value("TaskComment"),
        taskId: Schema.id<TaskId>(),
    }),
    DocumentCommentThread: Schema.object({
        type: Schema.value("DocumentCommentThread"),
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
    }),
});

/**
 * The storage key for a message draft's surface, used as the draft's DynamoDB sort
 * key. Derive it from a `MessageDraftSurface` with `getMessageDraftSurfaceKey()`.
 */
export type MessageDraftSurfaceKey =
    | `Chat:${ChatId}`
    | `PostComment:${PostId}`
    | `TaskComment:${TaskId}`
    | `DocumentCommentThread:${DocumentId}:${DocumentCommentThreadId}`;

export function getMessageDraftSurfaceKey(surface: MessageDraftSurface): MessageDraftSurfaceKey {
    switch (surface.type) {
        case "Chat":
            return `Chat:${surface.chatId}`;
        case "PostComment":
            return `PostComment:${surface.postId}`;
        case "TaskComment":
            return `TaskComment:${surface.taskId}`;
        case "DocumentCommentThread":
            return `DocumentCommentThread:${surface.documentId}:${surface.commentThreadId}`;
        default:
            throw exhaustive(surface);
    }
}
