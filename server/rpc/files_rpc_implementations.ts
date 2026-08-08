import {attachFileToTargetAsBot} from "~/server/files/data/attach_file_to_target_as_bot.js";
import {
    attachFileAsUploader,
    attachFileFromAttachment,
    finishUploadingAndStartProcessingFile,
    getFileAsUploader,
    getFileFromAttachment,
    startUploadingFile,
} from "~/server/files/data/files_actions.js";
import {getFileAttachmentTargetAuthorizer} from "~/server/files/data/get_file_attachment_target_authorizer.js";
import {getFileEntityIfPossible} from "~/server/files/data/get_file_entity_if_possible.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import * as definitions from "~/shared/rpc/files_rpc_definitions.js";

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
                    ? getFileAttachmentTargetAuthorizer(context, input.attachTarget)
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
            // `finishUploadingAndStartProcessingFile()` authorizes that the actor has access
            // to the file.
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
            const file = await getFileAsUploader(context, input.fileId);

            // It's ok to generate a signed URL here since `getFileAsUploader()` authorizes
            // that the actor has access to the file.
            const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
                file.spaceId,
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
                input.fileId,
                getFileAttachmentTargetAuthorizer(context, input.target),
            );

            // It's ok to generate a signed URL here since `getFileFromAttachment()` authorizes
            // that the actor has access to the file.
            const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
                file.spaceId,
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
            const file = await getFileAsUploader(context, input.fileId);
            return {file};
        },
    },

    getFileWithoutSignedUrlFromAttachment: {
        visibility: ["AppClient", "DocumentCollaborationService"],
        execute: async (context, input) => {
            const file = await getFileFromAttachment(
                context,
                input.fileId,
                getFileAttachmentTargetAuthorizer(context, input.target),
            );

            return {
                file,
            };
        },
    },

    getFileSignedUrlAsUploader: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const file = await getFileAsUploader(context, input.fileId);

            // It's ok to generate a signed URL here since `getFileAsUploader()` authorizes
            // that the actor has access to the file.
            const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
                file.spaceId,
                input.fileId,
            );

            return {signedUrlSearch: signedUrl.search};
        },
    },

    getFileSignedUrlFromAttachment: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const file = await getFileFromAttachment(
                context,
                input.fileId,
                getFileAttachmentTargetAuthorizer(context, input.target),
            );

            // It's ok to generate a signed URL here since `getFileFromAttachment()` authorizes
            // that the actor has access to the file.
            const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
                file.spaceId,
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
                input.fileId,
                getFileAttachmentTargetAuthorizer(context, input.target),
            );

            // It's ok to generate a signed URL here since `attachFileAsUploader()` authorizes
            // that the actor has access to the file.
            const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
                file.spaceId,
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
            const file = await attachFileFromAttachment(context, input.fileId, {
                from: getFileAttachmentTargetAuthorizer(context, input.fromTarget),
                to: getFileAttachmentTargetAuthorizer(context, input.toTarget),
            });

            // It's ok to generate a signed URL here since `attachFileFromAttachment()`
            // authorizes that the actor has access to the file.
            const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
                file.spaceId,
                input.fileId,
            );

            return {
                signedUrlSearch: signedUrl.search,
                file,
            };
        },
    },

    attachFileToTargetAsBot: {
        visibility: ["DocumentCollaborationService"],
        execute: async (context, input) => {
            const file = await attachFileToTargetAsBot(
                context,
                input.fileId,
                getFileAttachmentTargetAuthorizer(context, input.target),
            );

            return {file};
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

            // We return `null` when recursively loading file entities and the depth exceeds
            // some limit. Given we're loading the root file entity we'll always be at depth 0
            // and so should always return the file entity.
            assert(result);

            return {fileEntityResult: result};
        },
    },
});
