import "~/server/network/all-network-implementations";

import {getAllImplementedNetworkFunctionNames} from "~/server/network/internal/implement-network-function";
import {InternalError} from "~/shared/error/error";
import {quote} from "~/shared/helpers/string/quote";
// Allow this test to look at all defined network functions.
// eslint-disable-next-line no-internal-imports
import {getAllDefinedNetworkFunctionNames} from "~/shared/network/internal/define-network-function";

test("all network function definitions have implementations", async () => {
    const allDefinedNetworkFunctionNames = getAllDefinedNetworkFunctionNames();
    const allImplementedNetworkFunctionNames = new Set(getAllImplementedNetworkFunctionNames());

    for (const definedNetworkFunctionName of allDefinedNetworkFunctionNames) {
        if (!allImplementedNetworkFunctionNames.has(definedNetworkFunctionName)) {
            throw new InternalError(
                quote`Network function ${definedNetworkFunctionName} was defined but not implemented`,
            );
        }
    }
});
