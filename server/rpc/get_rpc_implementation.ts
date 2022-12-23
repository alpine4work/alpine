import "~/server/rpc/all_rpc_implementations";

import {RpcImplementation, getRpcImplementationIfExists} from "~/server/rpc/internal/implement_rpc";

/**
 * Get the implementation for a RPC with the given name.
 *
 * Importing this module also imports all RPC implementations so
 * we know that all implementations exist.
 */
export function getRpcImplementation(name: string): RpcImplementation | null {
    return getRpcImplementationIfExists(name);
}
