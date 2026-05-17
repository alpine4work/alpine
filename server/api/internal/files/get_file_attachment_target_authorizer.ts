import {FileChatAuthorizer} from "~/server/chat/data/file_chat_authorizer.js";
import {FileDocumentAuthorizer} from "~/server/documents/data/documents_actions.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/task_table.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export function getFileAttachmentTargetAuthorizer(target: FileAttachmentTarget): FileAuthorizer {
    switch (target.type) {
        case "ChatMessages":
            return FileChatAuthorizer.bind(target);
        case "Document":
        case "DocumentComments":
            return FileDocumentAuthorizer.bind(target);
        case "Post":
        case "PostDraft":
        case "PostComments":
            return FilePostAuthorizer.bind(target);
        case "TaskNotes":
        case "TaskComments":
            return FileTaskAuthorizer.bind(target);
        default:
            throw exhaustive(target);
    }
}
