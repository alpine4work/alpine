import {ServerContentActionContext} from "~/server/context/server_content_action_context.js";
import {
    createDocumentNotFoundError,
    getDocumentContentPreviewIfPossible,
} from "~/server/documents/data/documents_table.js";
import {FileDocumentEntityModel} from "~/shared/documents/file_document_entity_model_schema.js";
import {ErrorBase} from "~/shared/error/error.js";
import {Result} from "~/shared/helpers/control/result.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

export async function getFileDocumentEntityModelIfPossible(
    context: ServerContentActionContext,
    documentId: DocumentId,
): Promise<Result<FileDocumentEntityModel, ErrorBase>> {
    const documentResult = await getDocumentContentPreviewIfPossible(context, documentId);

    if (!documentResult) return {ok: false, error: createDocumentNotFoundError(documentId)};

    if (!documentResult.ok) return documentResult;
    const document = documentResult.value;

    return {
        ok: true,
        value: {
            type: "Document",
            // Always prefer the model with the higher preview version. If the preview
            // version is the same then use the document version (only applies to the
            // title).
            versions: [document.preview?.version ?? -1, document.version],
            id: documentId,
            version: document.version,
            titleWithoutFallback: document.titleWithoutFallback,
            preview: document.preview,
        },
    };
}
