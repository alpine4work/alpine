import {allRpcImplementations} from "~/server/rpc/all_rpc_implementations.js";
import {InternalError} from "~/shared/error/error.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {allRpcDefinitions} from "~/shared/rpc/all_rpc_definitions.js";

test("all RPC definitions have implementations", async () => {
    const allDefinedRpcNames = new Set(allRpcDefinitions.keys());
    const allImplementedRpcNames = new Set(allRpcImplementations.keys());

    for (const definedRpcName of allDefinedRpcNames) {
        if (!allImplementedRpcNames.has(definedRpcName)) {
            throw new InternalError(quote`RPC ${definedRpcName} was defined but not implemented`);
        }
    }
});

test("all RPC definitions have the same name as their definition key", async () => {
    for (const [key, definition] of allRpcDefinitions) {
        if (definition.name !== key) {
            throw new InternalError(
                quote`RPC ${definition.name} is exported with different key (${key})`,
            );
        }
    }
});
