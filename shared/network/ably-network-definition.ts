import {defineNetworkFunction} from "~/shared/network/internal/define-network-function";
import {Schema} from "~/shared/schema/schema";

/**
 * Ask our server to create an Ably authentication token with the
 * provided capabilities.
 */
export const authenticateAbly = defineNetworkFunction({
    name: "authenticateAbly",
    input: {
        capability: Schema.unknown,
    },
    output: {
        token: Schema.string,
    },
});
