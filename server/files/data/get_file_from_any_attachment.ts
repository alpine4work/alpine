import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableItemType} from "~/server/dynamo/core/dynamo_table_schema.js";
import {getFileAttachmentTargetAuthorizer} from "~/server/files/data/get_file_attachment_target_authorizer.js";
import {FilesTable} from "~/server/files/data/internal/files_table.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {FileModel} from "~/shared/files/file_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {FileId} from "~/shared/id/types/id_types.open_source.js";

type FileItem = DynamoTableItemType<typeof FilesTable, "File2", "Attributes">;

/**
 * Get a file by ID, authorizing through any of its attachment targets. Queries the
 * `File2` partition to find all entities the file is attached to, then tries each
 * target's `FileAuthorizer` until one succeeds.
 *
 * Use this when you have a `FileId` but don't know which entity it's attached to
 * (e.g. in the public API's `/files/{id}` endpoint).
 */
export async function getFileFromAnyAttachment(
    context: ServerActionContext,
    fileId: FileId,
): Promise<FileModel> {
    const targets: Array<FileAttachmentTarget> = [];

    const fileItems = await arrayFromAsyncIterable(
        FilesTable.query(context, {
            partitionKey: {partitionType: "File2", fileId},
            limit: "All",
            consistency: "Strong",
        }),
    );

    const fileItem: FileItem | undefined = findMapIterable(fileItems, item =>
        item.sortRangeType === "Attributes" ? item : undefined,
    );

    if (!fileItem) {
        throw new NotFoundError("File not found", {
            displayMessage: errorDisplayMessage`File not found.`,
        });
    }

    for (const item of fileItems) {
        const {sortRangeType} = item;
        switch (sortRangeType) {
            case "ChatMessagesAttachmentTarget":
                targets.push({type: "ChatMessages", chatId: item.chatId});
                break;
            case "DocumentAttachmentTarget":
                targets.push({type: "Document", documentId: item.documentId});
                break;
            case "DocumentCommentsAttachmentTarget":
                targets.push({type: "DocumentComments", documentId: item.documentId});
                break;
            case "PostAttachmentTarget":
                targets.push({type: "Post", postId: item.postId});
                break;
            case "PostDraftAttachmentTarget":
                targets.push({
                    type: "PostDraft",
                    spaceId: fileItem.spaceId,
                    accountId: item.accountId,
                    draftId: item.draftId,
                });
                break;
            case "PostCommentsAttachmentTarget":
                targets.push({type: "PostComments", postId: item.postId});
                break;
            case "TaskNotesAttachmentTarget":
                targets.push({type: "TaskNotes", taskId: item.taskId});
                break;
            case "TaskCommentsAttachmentTarget":
                targets.push({type: "TaskComments", taskId: item.taskId});
                break;
            case "Attributes":
                // Handled above.
                break;
            default:
                throw exhaustive(sortRangeType);
        }
    }

    const file = new FileModel({
        id: fileItem.fileId,
        spaceId: fileItem.spaceId,
        contentType: fileItem.contentType,
        contentLength: fileItem.contentLength,
        isUploading: fileItem.isUploading,
        alternative: fileItem.alternative,
        analysis: fileItem.analysis,
        preview: fileItem.preview,
        transcript: fileItem.transcript,
    });

    if (targets.length === 0) {
        throw new PermissionDeniedError("File is not attached to any entity", {
            displayMessage: errorDisplayMessage`You don\u2019t have access to this file.`,
        });
    }

    // Try all attachment targets in parallel until we find one the actor has access
    // to. Targets won't be ordered in any logical order so there's no benefit to
    // checking them sequentially.
    const results = await runAllPromises(
        targets.map(target => {
            const authorizer = getFileAttachmentTargetAuthorizer(context, target);
            return authorizer.authorizeTargetAccessIfPossible(context, "View", {
                consistency: "Strong",
            });
        }),
    );

    if (results.some(result => result.ok)) {
        return file;
    }

    throw new PermissionDeniedError("No access to file through any attachment target", {
        displayMessage: errorDisplayMessage`You don\u2019t have access to this file.`,
    });
}
