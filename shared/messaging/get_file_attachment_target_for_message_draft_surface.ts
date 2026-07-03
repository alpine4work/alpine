import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {MessageDraftSurface} from "~/shared/messaging/message_draft_surface.js";

/**
 * Returns the file attachment target used when hydrating files for a message draft
 * on the given surface.
 */
export function getFileAttachmentTargetForMessageDraftSurface(
    surface: MessageDraftSurface,
): FileAttachmentTarget {
    switch (surface.type) {
        case "Chat":
            return {type: "ChatMessages", chatId: surface.chatId};
        case "PostComment":
            return {type: "PostComments", postId: surface.postId};
        case "TaskComment":
            return {type: "TaskComments", taskId: surface.taskId};
        case "DocumentCommentThread":
            return {type: "DocumentComments", documentId: surface.documentId};
        default:
            throw exhaustive(surface);
    }
}
