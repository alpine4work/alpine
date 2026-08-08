import {ServerActionContext} from "~/server/context/server_action_context.js";
import {createFileEntitySitePreviewPrefetcher} from "~/server/files/data/internal/create_file_entity_site_preview_prefetcher.js";
import {createDocumentNotFoundError} from "~/shared/documents/document_error_messages.js";
import {FileDocumentEntityModel} from "~/shared/documents/file_document_entity_model_schema.js";
import {ErrorBase} from "~/shared/error/error.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

export async function getFileDocumentEntityModelIfPossible(
    context: ServerActionContext,
    documentId: DocumentId,
    options?: {siteIfAlreadyLoaded?: SitePreviewModel},
): Promise<Result<FileDocumentEntityModel, ErrorBase>> {
    const sitePreviewPrefetcher = createFileEntitySitePreviewPrefetcher(context, {
        siteIfAlreadyLoaded: options?.siteIfAlreadyLoaded,
    });

    const documentResult = await context.documentsInjection.getDocumentContentPreviewIfPossible(
        documentId,
        {onSiteId: sitePreviewPrefetcher.onSiteId},
    );

    if (!documentResult) return {ok: false, error: createDocumentNotFoundError(documentId)};

    if (!documentResult.ok) return documentResult;
    const document = documentResult.value;

    return {
        ok: true,
        value: {
            type: "Document",
            // Always prefer the model with the higher preview version. If the preview version
            // is the same then use the document version (only applies to the title).
            versions: [document.preview?.version ?? -1, document.version],
            id: documentId,
            version: document.version,
            titleWithoutFallback: document.titleWithoutFallback,
            preview: document.preview,
            site: await sitePreviewPrefetcher.get(),
        },
    };
}
