import {ApiContentExtended} from "~/server/api/content/from_api_content.js";
import {visitApiContent} from "~/server/api/content/visit_api_content.js";
import {FileId} from "~/shared/id/types/id_types.js";

/**
 * Extract all file IDs from API content by visiting FileRow and FileRowTable
 * elements.
 */
export function extractFileIdsFromApiContent(content: ApiContentExtended): Set<FileId> {
    const fileIds = new Set<FileId>();
    visitApiContent(content, {
        visitFileRow: element => {
            if (element.type === "FileRow") {
                for (const file of element.files) {
                    fileIds.add(file.fileId);
                }
            } else {
                fileIds.add(element.fileId);
            }
        },
    });
    return fileIds;
}
