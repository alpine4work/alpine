import {createDocument, getDocumentContentSteps} from "~/server/dynamo/documents_table";
import {implementNetworkFunction} from "~/server/network/internal/implement_network_function";
import * as definition from "~/shared/network/documents_network_definition";

implementNetworkFunction(definition.createDocument, async input => {
    await createDocument(input);
    return {};
});

implementNetworkFunction(definition.getDocumentContentSteps, async input => {
    const steps = await getDocumentContentSteps(input);
    return {steps};
});
