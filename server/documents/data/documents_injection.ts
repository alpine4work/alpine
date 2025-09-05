import {DocumentsInjection} from "~/server/context/injection_context_module.js";
import {
    authorizeDocumentAccessIfPossible,
    getDocumentAccessPolicyForBotScope,
    getDocumentContentPreviewIfPossible,
} from "~/server/documents/data/documents_actions.js";

export const documentsInjection: DocumentsInjection = {
    authorizeDocumentAccessIfPossible,
    getDocumentContentPreviewIfPossible,
    getDocumentAccessPolicyForBotScope,
};
