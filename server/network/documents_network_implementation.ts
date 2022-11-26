import {createDocument, getDocumentContentSteps} from "~/server/dynamo/documents_table";
import {implementNetworkFunction} from "~/server/network/internal/implement_network_function";
import * as definition from "~/shared/network/documents_network_definition";

implementNetworkFunction(definition.createDocument, async (context, input) => {
    await createDocument(await context.authenticate(), input);
    return {};
});

implementNetworkFunction(definition.getDocumentContentSteps, async (context, input) => {
    const steps = await getDocumentContentSteps(await context.authenticate(), input);
    return {steps};
});
