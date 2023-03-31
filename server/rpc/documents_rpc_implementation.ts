import {
    getDocumentCommentsFromEnd,
    getDocumentCommentsFromStart,
    getDocumentContentSteps,
} from "~/server/dynamo/documents_table";
import {implementRpc} from "~/server/rpc/internal/implement_rpc";
import * as definition from "~/shared/rpc/documents_rpc_definitions";

implementRpc(definition.getDocumentContentSteps, async (context, input) => {
    const steps = await getDocumentContentSteps(await context.auth.authenticate(), input);
    return {steps};
});

implementRpc(definition.getDocumentCommentsFromStart, async (context, input) => {
    return getDocumentCommentsFromStart(await context.auth.authenticate(), input);
});

implementRpc(definition.getDocumentCommentsFromEnd, async (context, input) => {
    return getDocumentCommentsFromEnd(await context.auth.authenticate(), input);
});
