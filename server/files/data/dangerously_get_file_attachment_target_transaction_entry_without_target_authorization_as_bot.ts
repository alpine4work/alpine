import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {FileAuthorizer} from "~/server/files/data/file_authorizer.js";
import {getFileWithUploaderIdIfExists} from "~/server/files/data/files_actions.js";
import {getFileFromAnyAttachment} from "~/server/files/data/get_file_from_any_attachment.js";
import {FilesTable} from "~/server/files/data/internal/files_table.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {FileId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Verifies a bot has access to a file and returns a transaction entry that
 * attaches the file to a target.
 *
 * This deliberately does not authorize access to the target. The caller must add
 * the returned entry to the same transaction as an authorized target mutation.
 */
export async function dangerouslyGetFileAttachmentTargetTransactionEntryWithoutTargetAuthorizationAsBot(
    context: ServerActionContext,
    fileId: FileId,
    targetAuthorizer: FileAuthorizer,
): Promise<DynamoTransactionEntry> {
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
    if (fileWithUploaderId.uploaderId !== context.actor.getBotAccountId()) {
        await getFileFromAnyAttachment(context, fileId);
    }

    assert(targetAuthorizer.target.type === "DocumentComments");

    return FilesTable.transactionCreateOrReplaceItem({
        partitionType: "File2",
        sortRangeType: "DocumentCommentsAttachmentTarget",
        fileId,
        documentId: targetAuthorizer.target.documentId,
        createdTime: new Date(),
    });
}
