import {
    createDocument,
    getDocument,
    getDocumentContentSteps,
    getDocumentPreview,
    updateDocumentContent,
} from "~/server/dynamo/documents_table";
import {implementNetworkChannelAuthorization} from "~/server/network/internal/implement_network_channel";
import {implementNetworkFunction} from "~/server/network/internal/implement_network_function";
import {implementNetworkPresenceChannelAuthorization} from "~/server/network/internal/implement_network_presence_channel";
import {PermissionDeniedError} from "~/shared/error/error";
import * as definition from "~/shared/network/documents_network_definition";

implementNetworkFunction(definition.createDocument, async input => {
    await createDocument(input);
    return {};
});

implementNetworkFunction(definition.updateDocumentContent, async input => {
    return await updateDocumentContent(input);
});

implementNetworkFunction(definition.getDocument, async input => {
    const document = await getDocument(input.id);
    return {document};
});

implementNetworkFunction(definition.getDocumentContentSteps, async input => {
    const steps = await getDocumentContentSteps(input);
    return {steps};
});

implementNetworkChannelAuthorization(definition.DocumentChannel, async key => {
    const documentPreview = await getDocumentPreview(key.documentId);
    if (!documentPreview)
        throw new PermissionDeniedError("Can not subscribe to document you do not have access to");
});

implementNetworkPresenceChannelAuthorization(
    definition.DocumentEditorPresenceChannel,
    async key => {
        const documentPreview = await getDocumentPreview(key.documentId);
        if (!documentPreview)
            throw new PermissionDeniedError(
                "Can not subscribe to document you do not have access to",
            );

        // TODO(calebmer): Test whether the current user can edit the document.
    },
);
