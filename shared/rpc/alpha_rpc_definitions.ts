import {AlphaConfigurationSchema} from "~/shared/alpha/alpha_configuration_schema.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

export const approveAlphaAccessRequest = defineRpc({
    name: "approveAlphaAccessRequest",
    input: {
        emailAddress: Schema.string,
    },
    output: {},
});

export const denyAlphaAccessRequest = defineRpc({
    name: "denyAlphaAccessRequest",
    input: {
        emailAddress: Schema.string,
    },
    output: {},
});

export const saveAlphaConfiguration = defineRpc({
    name: "saveAlphaConfiguration",
    input: {
        configuration: AlphaConfigurationSchema,
    },
    output: {},
});
