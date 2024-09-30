import {FileChatAuthorizer} from "~/server/chat/data/chat_table.js";
import {FileDocumentAuthorizer} from "~/server/documents/data/documents_table.js";
import {FileAuthorizer, getFileFromAttachment} from "~/server/files/data/files_table.js";
import {FileChannelAuthorizer, FilePostAuthorizer} from "~/server/forum/data/forum_table.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/task_table.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import * as definitions from "~/shared/rpc/files_rpc_definitions.js";

export function getFileAttachmentTargetAuthorizer(target: FileAttachmentTarget): FileAuthorizer {
    switch (target.type) {
        case "ChatMessage":
            return FileChatAuthorizer.bind(target);
        case "ChannelDescription":
            return FileChannelAuthorizer.bind(target);
        case "Document":
        case "DocumentComment":
            return FileDocumentAuthorizer.bind(target);
        case "Post":
        case "PostComment":
            return FilePostAuthorizer.bind(target);
        case "TaskNotes":
        case "TaskComment":
            return FileTaskAuthorizer.bind(target);
        default:
            throw exhaustive(target);
    }
}

export default implementRpcs(definitions, {
    getFileFromAttachment: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const file = await getFileFromAttachment(
                context,
                input.spaceId,
                input.fileId,
                getFileAttachmentTargetAuthorizer(input.target),
            );

            let previewUrl: URL | null = null;

            // If there was an error while processing then don't generate a preview URL
            // since the client will render an error message, not a preview.
            //
            // It's ok to generate a signed URL here since `getFileFromAttachment()`
            // authorizes that the actor has access to the file.
            if (
                input.withPreviewUrl &&
                file.preview &&
                (!("ok" in file.preview) || file.preview.ok === true)
            ) {
                previewUrl = await context.files.dangerouslySignFilePreviewUrlWithoutAuthorization(
                    input.spaceId,
                    input.fileId,
                    file,
                );
            }

            return {
                file,
                previewUrlSearch: previewUrl?.search ?? null,
            };
        },
    },
    getFilePreviewUrlFromAttachment: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const file = await getFileFromAttachment(
                context,
                input.spaceId,
                input.fileId,
                getFileAttachmentTargetAuthorizer(input.target),
            );

            let previewUrl: URL | null = null;

            // If there was an error while processing then don't generate a preview URL
            // since the client will render an error message, not a preview.
            //
            // It's ok to generate a signed URL here since `getFileFromAttachment()`
            // authorizes that the actor has access to the file.
            if (file.preview && (!("ok" in file.preview) || file.preview.ok === true)) {
                previewUrl = await context.files.dangerouslySignFilePreviewUrlWithoutAuthorization(
                    input.spaceId,
                    input.fileId,
                    file,
                );
            }

            return {previewUrlSearch: previewUrl?.search ?? null};
        },
    },
});
