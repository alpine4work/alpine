import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export function getFileAttachmentTargetAuthorizer(
    context: ServerMinimalActionContext,
    target: FileAttachmentTarget,
): FileAuthorizer {
    switch (target.type) {
        case "ChatMessages":
            return context.chatInjection.bindFileChatAuthorizer(target);
        case "Document":
        case "DocumentComments":
            return context.documentsInjection.bindFileDocumentAuthorizer(target);
        case "Post":
        case "PostDraft":
        case "PostComments":
            return context.forumInjection.bindFilePostAuthorizer(target);
        case "TaskNotes":
        case "TaskComments":
            return context.tasksInjection.bindFileTaskAuthorizer(target);
        default:
            throw exhaustive(target);
    }
}
