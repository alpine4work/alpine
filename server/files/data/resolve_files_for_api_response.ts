import {ServerActionContext} from "~/server/context/server_action_context.js";
import {FilesTable} from "~/server/files/data/internal/files_table.js";
import {computeApiContentFileRowWidths} from "~/shared/api/content/compute_api_content_file_row_widths.js";
import {
    ApiContentFileBlockElementResponse,
    ApiContentPreviewBlockElementResponse,
    ApiMessageContentPayloadFileResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {fileRowMaxFileCount} from "~/shared/content/compute_file_row_widths.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {FileEntityId, isFileEntityId, parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Resolve a list of file IDs into API file or preview metadata for responses.
 * Plain FileIds are resolved to file metadata. FileEntityIds are resolved to
 * Preview elements. Entries that can't be resolved are silently skipped.
 */
export async function resolveFilesForApiResponse(
    context: ServerActionContext,
    spaceId: SpaceId,
    fileIds: ReadonlyArray<FileId | string>,
): Promise<Array<ApiMessageContentPayloadFileResponse>> {
    const results: Array<{
        element: ApiContentFileBlockElementResponse | ApiContentPreviewBlockElementResponse;
        file?: {
            contentType: FileContentType;
            size?: {width: number | null; height: number; scale?: number} | null;
        };
    }> = [];

    for (const fileId of fileIds) {
        if (isFileEntityId(fileId)) {
            const preview = resolveFileEntityIdToPreview(fileId);
            if (preview) results.push({element: preview});
            continue;
        }

        if (!isId<FileId>(fileId)) continue;

        const fileItem = await FilesTable.getItemIfExists(
            context,
            {partitionType: "File2", sortRangeType: "Attributes", fileId},
            {consistency: "StrongWithinCache"},
        );
        if (!fileItem || fileItem.spaceId !== spaceId) continue;

        results.push({
            element: {
                type: "File",
                id: fileId,
                contentType: fileItem.contentType,
                contentLength: fileItem.contentLength,
            },
            file: {
                contentType: fileItem.contentType,
                size:
                    fileItem.preview?.type === "Image" && typeof fileItem.preview.size === "object"
                        ? fileItem.preview.size
                        : null,
            },
        });
    }

    const response: Array<ApiMessageContentPayloadFileResponse> = [];

    for (let rowIndex = 0; rowIndex * fileRowMaxFileCount < results.length; rowIndex++) {
        const rowResults = results.slice(
            rowIndex * fileRowMaxFileCount,
            (rowIndex + 1) * fileRowMaxFileCount,
        );

        const rowFilesById = new Map(
            rowResults.flatMap(result =>
                result.element.type === "File" && result.file
                    ? [[result.element.id, result.file] as const]
                    : [],
            ),
        );

        const widths = computeApiContentFileRowWidths(
            rowResults.map(result => result.element),
            {
                getFileIfExists: fileId => rowFilesById.get(fileId),
            },
        );

        for (let fileIndex = 0; fileIndex < rowResults.length; fileIndex++) {
            response.push({
                rowIndex,
                width: widths[fileIndex]!,
                element: rowResults[fileIndex]!.element,
            });
        }
    }

    return response;
}

function resolveFileEntityIdToPreview(
    fileEntityId: FileEntityId,
): ApiContentPreviewBlockElementResponse | null {
    const entityIdObject = parseFileEntityId(fileEntityId);

    // TODO(#sites): Add Site to PreviewTarget.
    switch (entityIdObject.type) {
        case "Document":
            return {
                type: "Preview",
                target: {type: "Document", id: entityIdObject.documentId},
                title: "Document",
            };
        case "Channel":
            return {
                type: "Preview",
                target: {type: "Channel", id: entityIdObject.channelId},
                title: "Channel",
            };
        case "Chat":
            return {
                type: "Preview",
                target: {type: "Chat", id: entityIdObject.chatId},
                title: "Chat",
            };
        case "Post":
            return {
                type: "Preview",
                target: {type: "Post", id: entityIdObject.postId},
                title: "Post",
            };
        case "Task":
            return {
                type: "Preview",
                target: {
                    type: "Task",
                    id: entityIdObject.taskId,
                    status: {type: "Closed"},
                },
                title: "Task",
            };
        case "TaskCollection":
            return {
                type: "Preview",
                target: {type: "TaskCollection", id: entityIdObject.collectionId},
                title: "Task Collection",
            };
        case "Site":
            return null;
        default:
            throw exhaustive(entityIdObject);
    }
}
