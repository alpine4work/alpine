import {
    approveAlphaAccessRequest,
    denyAlphaAccessRequest,
    saveAlphaConfiguration,
} from "~/server/dynamo/alpha_access_table";
import {implementNetworkFunction} from "~/server/network/internal/implement_network_function";
import * as definition from "~/shared/network/alpha_network_definition";

implementNetworkFunction(definition.approveAlphaAccessRequest, async (context, input) => {
    await approveAlphaAccessRequest(await context.authenticate(), input.emailAddress);
    return {};
});

implementNetworkFunction(definition.denyAlphaAccessRequest, async (context, input) => {
    await denyAlphaAccessRequest(await context.authenticate(), input.emailAddress);
    return {};
});

implementNetworkFunction(definition.saveAlphaConfiguration, async (context, input) => {
    await saveAlphaConfiguration(await context.authenticate(), input.configuration);
    return {};
});
