import {
    approveAlphaAccessRequest,
    denyAlphaAccessRequest,
    saveAlphaConfiguration,
} from "~/server/dynamo/alpha_access_table.js";
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import * as definition from "~/shared/rpc/alpha_rpc_definitions.js";

implementRpc(
    definition.approveAlphaAccessRequest,
    {visibility: ["AppClient"]},
    async (context, input) => {
        await approveAlphaAccessRequest(
            context.actor.authorizeSession(),
            await validateEmailAddress(context, input.emailAddress),
        );
        return {};
    },
);

implementRpc(
    definition.denyAlphaAccessRequest,
    {visibility: ["AppClient"]},
    async (context, input) => {
        await denyAlphaAccessRequest(
            context.actor.authorizeSession(),
            await validateEmailAddress(context, input.emailAddress),
        );
        return {};
    },
);

implementRpc(
    definition.saveAlphaConfiguration,
    {visibility: ["AppClient"]},
    async (context, input) => {
        await saveAlphaConfiguration(context, input.configuration);
        return {};
    },
);
