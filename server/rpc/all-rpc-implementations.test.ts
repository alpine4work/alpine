import "~/server/rpc/all-rpc-implementations";

import {getAllImplementedRpcNames} from "~/server/rpc/internal/implement-rpc";
import {InternalError} from "~/shared/error/error";
import {quote} from "~/shared/helpers/string/quote";
// Allow this test to look at all defined RPCs.
// eslint-disable-next-line no-internal-imports
import {getAllDefinedRpcNames} from "~/shared/rpc/internal/define-rpc";

test("all RPC definitions have implementations", async () => {
    const allDefinedRpcNames = getAllDefinedRpcNames();
    const allImplementedRpcNames = new Set(getAllImplementedRpcNames());

    for (const definedRpcName of allDefinedRpcNames) {
        if (!allImplementedRpcNames.has(definedRpcName)) {
            throw new InternalError(quote`RPC ${definedRpcName} was defined but not implemented`);
        }
    }
});
