import {defineNetworkFunction} from "~/shared/network/internal/define_network_function";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";

export const approveAlphaAccessRequest = defineNetworkFunction({
    name: "approveAlphaAccessRequest",
    input: {
        emailAddress: LabelStringSchema,
    },
    output: {},
});

export const denyAlphaAccessRequest = defineNetworkFunction({
    name: "denyAlphaAccessRequest",
    input: {
        emailAddress: LabelStringSchema,
    },
    output: {},
});
