import {createDocument, updateDocumentContent} from "~/server/dynamo/documents-table";
import {implementNetworkFunction} from "~/server/network/internal/implement-network-function";
import * as definition from "~/shared/network/documents-network-definition";

implementNetworkFunction(definition.createDocument, async input => {
    await createDocument(input);
    return {};
});

implementNetworkFunction(definition.updateDocumentContent, async input => {
    return await updateDocumentContent(input);
});
