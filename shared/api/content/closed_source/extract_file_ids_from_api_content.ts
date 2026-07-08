import {visitApiContent} from "~/shared/api/content/visit_api_content.js";
import {ApiContent} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {FileId} from "~/shared/id/types/id_types.js";

/**
 * Extract all file IDs from API content by visiting File, FileGallery, and
 * FileFloat elements.
 */
export function extractFileIdsFromApiContent(content: ApiContent): Set<FileId> {
    const fileIds = new Set<FileId>();
    visitApiContent(content, {
        visitBlockElement: element => {
            if (element.type === "File" && element.file.id !== null) {
                fileIds.add(element.file.id);
            }
        },
    });
    return fileIds;
}
