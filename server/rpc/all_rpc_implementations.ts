// TODO(calebmer): Some kind of test or codegen to ensure all RPC
// implementations are actually imported.

import "~/server/rpc/alpha_rpc_implementation";
import "~/server/rpc/documents_rpc_implementation";
import "~/shared/rpc/all_rpc_definitions";

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
