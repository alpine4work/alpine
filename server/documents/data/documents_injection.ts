import {DocumentsInjection} from "~/server/context/injection_context_module.js";
import {
    authorizeDocumentAccessIfPossible,
    getDocumentContentPreviewIfPossible,
} from "~/server/documents/data/documents_table.js";

export const documentsInjection: DocumentsInjection = {
    authorizeDocumentAccessIfPossible,
    getDocumentContentPreviewIfPossible,
};
