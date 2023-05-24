import {AlphaConfigurationSchema} from "~/shared/alpha/alpha_configuration_schema";
import {defineRpc} from "~/shared/rpc/internal/define_rpc";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";

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
