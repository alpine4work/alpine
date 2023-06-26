import {AlphaConfigurationSchema} from "~/shared/alpha/alpha_configuration_schema.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {LabelStringSchema} from "~/shared/schema/label_string_schema.js";

export const approveAlphaAccessRequest = defineRpc({
    name: "approveAlphaAccessRequest",
    input: {
        emailAddress: LabelStringSchema,
    },
    output: {},
});

export const denyAlphaAccessRequest = defineRpc({
    name: "denyAlphaAccessRequest",
    input: {
        emailAddress: LabelStringSchema,
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
