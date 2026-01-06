import {
    approveAlphaAccessRequest,
    denyAlphaAccessRequest,
    saveAlphaConfiguration,
} from "~/server/alpha/alpha_access_table.js";
import {validateEmailAddress} from "~/server/emails/email_address.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import * as definitions from "~/shared/rpc/alpha_rpc_definitions.js";

export default implementRpcs(definitions, {
    approveAlphaAccessRequest: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await approveAlphaAccessRequest(
                context.actor.authorizeSession(),
                validateEmailAddress(input.emailAddress),
            );
            return {};
        },
    },

    denyAlphaAccessRequest: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await denyAlphaAccessRequest(
                context.actor.authorizeSession(),
                validateEmailAddress(input.emailAddress),
            );
            return {};
        },
    },

    saveAlphaConfiguration: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await saveAlphaConfiguration(context, input.configuration);
            return {};
        },
    },
});
