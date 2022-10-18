// TODO(calebmer): Some kind of test or codegen to ensure all RPC
// implementations are actually imported.

import "~/server/rpc/documents-rpc-implementation";
import "~/shared/rpc/all-rpc-definitions";

import {RpcImplementation, getRpcImplementationIfExists} from "~/server/rpc/internal/implement-rpc";

/**
 * Get the implementation for an RPC with the given name.
 *
 * Importing this module also imports all RPC implementations so we know that all
 * RPC implementations exist.
 */
export function getRpcImplementation(name: string): RpcImplementation | null {
    return getRpcImplementationIfExists(name);
}
