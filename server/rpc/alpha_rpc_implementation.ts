import {
    approveAlphaAccessRequest,
    denyAlphaAccessRequest,
    saveAlphaConfiguration,
} from "~/server/dynamo/alpha_access_table.js";
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import * as definition from "~/shared/rpc/alpha_rpc_definitions.js";

implementRpc(definition.approveAlphaAccessRequest, async (context, input) => {
    await approveAlphaAccessRequest(
        await context.actor.authenticate(),
        await validateEmailAddress(context, input.emailAddress),
    );
    return {};
});

implementRpc(definition.denyAlphaAccessRequest, async (context, input) => {
    await denyAlphaAccessRequest(
        await context.actor.authenticate(),
        await validateEmailAddress(context, input.emailAddress),
    );
    return {};
});

implementRpc(definition.saveAlphaConfiguration, async (context, input) => {
    await saveAlphaConfiguration(await context.actor.authenticate(), input.configuration);
    return {};
});
