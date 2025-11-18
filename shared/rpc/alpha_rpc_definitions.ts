import {AlphaConfigurationSchema} from "~/shared/alpha/alpha_configuration_schema.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";

export const approveAlphaAccessRequest = defineRpc({
    name: "approveAlphaAccessRequest",
    // Fails if the request is already approved or denied.
    isIdempotent: false,
    input: {
        emailAddress: Schema.string,
    },
    output: {},
});

export const denyAlphaAccessRequest = defineRpc({
    name: "denyAlphaAccessRequest",
    // Fails if the request is already approved or denied.
    isIdempotent: false,
    input: {
        emailAddress: Schema.string,
    },
    output: {},
});

export const saveAlphaConfiguration = defineRpc({
    name: "saveAlphaConfiguration",
    isIdempotent: true,
    input: {
        configuration: AlphaConfigurationSchema,
    },
    output: {},
});
