import {ServerActionContext} from "~/server/context/server_action_context.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {
    createFileAttachmentTarget,
    getFileWithUploaderIdIfExists,
} from "~/server/files/data/files_actions.js";
import {getFileFromAnyAttachment} from "~/server/files/data/get_file_from_any_attachment.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {FileModel} from "~/shared/files/file_model.js";
import {FileId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Attach a file to an entity on behalf of a bot actor. Verifies the bot has rights
 * to the file (either as the uploader or through an existing attachment target the
 * bot can access).
 *
 * Does not authorize access to the target entity, callers are responsible for
 * ensuring the bot has appropriate access to the target.
 *
 * Uses `createOrReplaceItem` so re-attaching an already-attached file is a no-op.
 */
export async function attachFileToTargetAsBot(
    context: ServerActionContext,
    fileId: FileId,
    targetAuthorizer: FileAuthorizer,
): Promise<FileModel> {
    if (context.actor.type !== "Bot") {
        throw new PermissionDeniedError("Only bot actors can attach files to targets", {
            displayMessage: errorDisplayMessage`Only bots can attach files to targets.`,
        });
    }

    const fileWithUploaderId = await getFileWithUploaderIdIfExists(
        context,
        fileId,
        context.actor.getSpaceId(),
    );

    if (fileWithUploaderId === null) {
        throw new NotFoundError("File not found", {
            displayMessage: errorDisplayMessage`File not found.`,
        });
    }

    // Verify the bot has rights to this file: either they uploaded it or they can
    // access it through an existing attachment target.
    const file =
        fileWithUploaderId.uploaderId === context.actor.getBotAccountId()
            ? fileWithUploaderId.file
            : await getFileFromAnyAttachment(context, fileId);

    await createFileAttachmentTarget(context, fileId, targetAuthorizer.target);

    return file;
}
