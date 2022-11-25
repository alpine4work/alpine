import {
    approveAlphaAccessRequest,
    denyAlphaAccessRequest,
} from "~/server/dynamo/alpha_access_table";
import {implementNetworkFunction} from "~/server/network/internal/implement_network_function";
import * as definition from "~/shared/network/alpha_network_definition";

implementNetworkFunction(definition.approveAlphaAccessRequest, async (input, context) => {
    await approveAlphaAccessRequest(await context.authenticate(), input.emailAddress);
    return {};
});

implementNetworkFunction(definition.denyAlphaAccessRequest, async (input, context) => {
    await denyAlphaAccessRequest(await context.authenticate(), input.emailAddress);
    return {};
});
