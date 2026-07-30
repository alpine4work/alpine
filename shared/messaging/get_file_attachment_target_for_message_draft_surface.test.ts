import {generateId} from "~/shared/id/id.js";
import {
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {getFileAttachmentTargetForMessageDraftSurface} from "~/shared/messaging/get_file_attachment_target_for_message_draft_surface.js";

describe("getFileAttachmentTargetForMessageDraftSurface()", () => {
    test("maps chat surfaces to chat message attachments", () => {
        const chatId = generateId<ChatId>();

        expect(getFileAttachmentTargetForMessageDraftSurface({type: "Chat", chatId})).toEqual({
            type: "ChatMessages",
            chatId,
        });
    });

    test("maps post comment surfaces to post comment attachments", () => {
        const postId = generateId<PostId>();

        expect(
            getFileAttachmentTargetForMessageDraftSurface({type: "PostComment", postId}),
        ).toEqual({type: "PostComments", postId});
    });

    test("maps task comment surfaces to task comment attachments", () => {
        const taskId = generateId<TaskId>();

        expect(
            getFileAttachmentTargetForMessageDraftSurface({type: "TaskComment", taskId}),
        ).toEqual({type: "TaskComments", taskId});
    });

    test("maps document comment thread surfaces to document comment attachments", () => {
        const documentId = generateId<DocumentId>();
        const commentThreadId = generateId<DocumentCommentThreadId>();

        expect(
            getFileAttachmentTargetForMessageDraftSurface({
                type: "DocumentCommentThread",
                documentId,
                commentThreadId,
            }),
        ).toEqual({type: "DocumentComments", documentId});
    });
});
