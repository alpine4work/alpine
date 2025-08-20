import {FileChatAuthorizer} from "~/server/chat/data/chat_actions.js";
import {FileDocumentAuthorizer} from "~/server/documents/data/documents_table.js";
import {
    FileAuthorizer,
    attachFileAsUploader,
    attachFileFromAttachment,
    finishUploadingAndStartProcessingFile,
    getFileAsUploader,
    getFileFromAttachment,
    startUploadingFile,
} from "~/server/files/data/files_table.js";
import {getFileEntityIfPossible} from "~/server/files/data/get_file_entity_if_possible.js";
import {FilePostAuthorizer} from "~/server/forum/data/forum_table.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {FileTaskAuthorizer} from "~/server/tasks/data/task_table.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import * as definitions from "~/shared/rpc/files_rpc_definitions.js";

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

export default implementRpcs(definitions, {
    startUploadingFile: {
        visibility: ["EdgeService"],
        execute: async (context, input) => {
            const {fileId} = await startUploadingFile(context.actor.authorizeSession(), {
                spaceId: input.spaceId,
                fileId: input.fileId,
                contentType: input.contentType,
                contentLength: input.contentLength,
                attachTargetAuthorizer: input.attachTarget
                    ? getFileAttachmentTargetAuthorizer(input.attachTarget)
                    : null,
            });

            return {fileId};
        },
    },

    finishUploadingAndStartProcessingFile: {
        visibility: ["EdgeService"],
        execute: async (context, input) => {
            const file = await finishUploadingAndStartProcessingFile(
                context.actor.authorizeSession(),
                input,
            );

            // It's ok to generate a signed URL here since
            // `finishUploadingAndStartProcessingFile()` authorizes that the actor has
            // access to the file.
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

    getFileAsUploader: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const file = await getFileAsUploader(context, input.spaceId, input.fileId);

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

    getFileWithoutSignedUrlAsUploader: {
        visibility: ["AppClient", "EdgeService"],
        execute: async (context, input) => {
            const file = await getFileAsUploader(context, input.spaceId, input.fileId);
            return {file};
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

    getFileSignedUrlAsUploader: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await getFileAsUploader(context, input.spaceId, input.fileId);

            // It's ok to generate a signed URL here since `getFileFromAttachment()`
            // authorizes that the actor has access to the file.
            const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
                input.spaceId,
                input.fileId,
            );

            return {signedUrlSearch: signedUrl.search};
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
            const file = await attachFileAsUploader(
                context,
                input.spaceId,
                input.fileId,
                getFileAttachmentTargetAuthorizer(input.target),
            );

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

    getFileEntityIfPossible: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const result = await getFileEntityIfPossible(
                context,
                input.spaceId,
                input.fileEntityId,
            );

            // We return `null` when recursively loading file entities and the depth
            // exceeds some limit. Given we're loading the root file entity we'll always be
            // at depth 0 and so should always return the file entity.
            assert(result);

            return {fileEntityResult: result};
        },
    },
});
