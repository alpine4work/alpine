import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {getFileAsUploader, getFileFromAttachment} from "~/server/files/data/files_actions.js";
import {getFileAttachmentTargetAuthorizer} from "~/server/files/data/get_file_attachment_target_authorizer.js";
import {getFileEntityIfPossible} from "~/server/files/data/get_file_entity_if_possible.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileEntityId, isFileEntityId} from "~/shared/files/file_entity_id.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.open_source.js";
import {isId} from "~/shared/id/id.open_source.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {getFileAttachmentTargetForMessageDraftSurface} from "~/shared/messaging/get_file_attachment_target_for_message_draft_surface.js";
import {MessageDraftFile} from "~/shared/messaging/message_draft_schema.js";
import {MessageDraftSurface} from "~/shared/messaging/message_draft_surface.js";

/**
 * Hydrates message draft file ids into file models for the given surface.
 */
export async function getMessageDraftFiles(
    context: ServerSessionActionContext,
    {
        spaceId,
        surface,
        fileIds,
        withAttachFileBeforeCreateMessage = false,
    }: {
        spaceId: SpaceId;
        surface: MessageDraftSurface;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
        withAttachFileBeforeCreateMessage?: boolean;
    },
): Promise<ReadonlyArray<MessageDraftFile>> {
    await authorizeSpaceAccess(context, spaceId);

    const fileAttachmentTarget = withAttachFileBeforeCreateMessage
        ? null
        : getFileAttachmentTargetForMessageDraftSurface(surface);

    const files = await runAllPromises(
        fileIds.map(async (fileId): Promise<MessageDraftFile | null> => {
            try {
                return await getMessageDraftFile(context, {
                    spaceId,
                    fileId,
                    fileAttachmentTarget,
                    withAttachFileBeforeCreateMessage,
                });
            } catch (error) {
                context.tracer.logException("Failed to load message draft file", error);
                return null;
            }
        }),
    );

    return files.filter(isNonNullable);
}

async function getMessageDraftFile(
    context: ServerSessionActionContext,
    {
        spaceId,
        fileId,
        fileAttachmentTarget,
        withAttachFileBeforeCreateMessage,
    }: {
        spaceId: SpaceId;
        fileId: FileId | FileEntityId;
        fileAttachmentTarget: FileAttachmentTarget | null;
        withAttachFileBeforeCreateMessage?: boolean;
    },
): Promise<MessageDraftFile> {
    if (isId<FileId>(fileId)) {
        const shouldLoadAsUploader = withAttachFileBeforeCreateMessage || !fileAttachmentTarget;
        const file = shouldLoadAsUploader
            ? await getFileAsUploader(context, fileId)
            : await getFileFromAttachment(
                  context,
                  fileId,
                  getFileAttachmentTargetAuthorizer(context, fileAttachmentTarget),
              );
        const signedUrl = await context.files.dangerouslySignFileUrlWithoutAuthorization(
            file.spaceId,
            fileId,
        );

        return {
            type: "File",
            fileId,
            attachmentTarget: shouldLoadAsUploader ? null : fileAttachmentTarget,
            shouldAttachBeforeCreate: shouldLoadAsUploader,
            signedUrlSearch: signedUrl.search,
            file,
        };
    }

    if (isFileEntityId(fileId)) {
        const fileEntityResult = await getFileEntityIfPossible(context, spaceId, fileId);
        assert(fileEntityResult);

        return {
            type: "FileEntity",
            fileId,
            fileEntityResult,
        };
    }

    throw new InternalError("Unexpected message draft file id");
}
