import {
    createDocument,
    readDocument,
    readDocumentPreview,
    updateDocumentContent,
} from "~/server/dynamo/documents-table";
import {implementNetworkChannelAuthorization} from "~/server/network/internal/implement-network-channel";
import {implementNetworkFunction} from "~/server/network/internal/implement-network-function";
import {implementNetworkPresenceChannelAuthorization} from "~/server/network/internal/implement-network-presence-channel";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error";
import * as definition from "~/shared/network/documents-network-definition";

implementNetworkFunction(definition.createDocument, async input => {
    await createDocument(input);
    return {};
});

implementNetworkFunction(definition.updateDocumentContent, async input => {
    return await updateDocumentContent(input);
});

implementNetworkFunction(definition.readDocumentForCollaborationWorker, async input => {
    const document = await readDocument(input.id);
    if (!document) {
        throw new NotFoundError("Document does not exist");
    }
    return {
        id: document.id,
        content: document.content,
        version: document.version,
    };
});

implementNetworkChannelAuthorization(definition.DocumentChannel, async key => {
    const documentPreview = await readDocumentPreview(key.documentId);
    if (!documentPreview)
        throw new PermissionDeniedError("Can not subscribe to document you do not have access to");
});

implementNetworkPresenceChannelAuthorization(
    definition.DocumentEditorPresenceChannel,
    async key => {
        const documentPreview = await readDocumentPreview(key.documentId);
        if (!documentPreview)
            throw new PermissionDeniedError(
                "Can not subscribe to document you do not have access to",
            );

        // TODO(calebmer): Test whether the current user can edit the document.
    },
);
