import "~/server/rpc/all_rpc_implementations.js";

import {
    RpcImplementation,
    getRpcImplementationIfExists as _getRpcImplementationIfExists,
} from "~/server/rpc/internal/implement_rpc.js";

/**
 * Get the implementation for a RPC with the given name.
 *
 * Importing this module also imports all RPC implementations so
 * we know that all implementations exist.
 */
export async function getRpcImplementationIfExists(
    name: string,
): Promise<RpcImplementation | null> {
    return _getRpcImplementationIfExists(name);
}
