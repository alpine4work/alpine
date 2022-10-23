import {createDocument, updateDocumentContent} from "~/server/dynamo/documents-table";
import {implementRpc} from "~/server/rpc/internal/implement-rpc";
import * as definition from "~/shared/rpc/documents-rpc-definition";

implementRpc(definition.createDocument, async input => {
    await createDocument(input);
    return {};
});

implementRpc(definition.updateDocumentContent, async input => {
    return await updateDocumentContent(input);
});
