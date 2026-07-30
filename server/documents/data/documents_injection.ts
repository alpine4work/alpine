import {DocumentsInjection} from "~/server/context/injection_context_module.js";
import {
    FileDocumentAuthorizer,
    authorizeDocumentAccessIfPossible,
    getDocumentAccessPolicyForBotScope,
    getDocumentContentPreviewIfPossible,
} from "~/server/documents/data/documents_actions.js";

export const documentsInjection: DocumentsInjection = {
    authorizeDocumentAccessIfPossible,
    getDocumentContentPreviewIfPossible,
    getDocumentAccessPolicyForBotScope,
    bindFileDocumentAuthorizer: (_context, target) => FileDocumentAuthorizer.bind(target),
};
