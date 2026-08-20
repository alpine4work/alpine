import {ApiContentFileBlockElement} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {FileModelData} from "~/shared/files/file_model.js";
import {FileId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Convert stored file data into the metadata returned by API content responses.
 */
export function intoApiContentFileResponse(
    fileId: FileId,
    file: FileModelData | undefined,
): ApiContentFileBlockElement["file"] {
    const analysis = file?.analysis;
    const analysisResult =
        analysis === null || analysis === undefined || analysis.isProcessing || !analysis.ok
            ? undefined
            : analysis.result;

    return {
        id: fileId,
        contentType: file?.contentType ?? "application/octet-stream",
        contentLength: file?.contentLength ?? 0,
        ...(analysisResult?.caption !== undefined ? {caption: analysisResult.caption} : {}),
    };
}
