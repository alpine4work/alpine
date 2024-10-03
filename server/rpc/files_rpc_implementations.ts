import {FileChatAuthorizer} from "~/server/chat/data/chat_table.js";
import {FileDocumentAuthorizer} from "~/server/documents/data/documents_table.js";
import {
    FileAuthorizer,
    attachFileAsUploader,
    attachFileFromAttachment,
    getFileFromAttachment,
} from "~/server/files/data/files_table.js";
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

            // It's ok to generate a signed URL here since `getFileFromAttachment()`
            // authorizes that the actor has access to the file.
            const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
                input.spaceId,
                input.fileId,
            );

            return {
                signedUrlSearch: signedUrl.search,
                file,
            };
        },
    },

    getFileWithoutSignedUrlFromAttachment: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const file = await getFileFromAttachment(
                context,
                input.spaceId,
                input.fileId,
                getFileAttachmentTargetAuthorizer(input.target),
            );

            return {
                file,
            };
        },
    },

    getFileSignedUrlFromAttachment: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await getFileFromAttachment(
                context,
                input.spaceId,
                input.fileId,
                getFileAttachmentTargetAuthorizer(input.target),
            );

            // It's ok to generate a signed URL here since `getFileFromAttachment()`
            // authorizes that the actor has access to the file.
            const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
                input.spaceId,
                input.fileId,
            );

            return {signedUrlSearch: signedUrl.search};
        },
    },

    attachFileAsUploader: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await attachFileAsUploader(
                context,
                input.spaceId,
                input.fileId,
                getFileAttachmentTargetAuthorizer(input.target),
            );

            return {};
        },
    },

    attachFileFromAttachment: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const file = await attachFileFromAttachment(context, input.spaceId, input.fileId, {
                from: getFileAttachmentTargetAuthorizer(input.fromTarget),
                to: getFileAttachmentTargetAuthorizer(input.toTarget),
            });

            // It's ok to generate a signed URL here since `attachFileFromAttachment()`
            // authorizes that the actor has access to the file.
            const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
                input.spaceId,
                input.fileId,
            );

            return {
                signedUrlSearch: signedUrl.search,
                file,
            };
        },
    },
});
