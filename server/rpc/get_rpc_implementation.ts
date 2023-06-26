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
    // NOTE(calebmer, 2023-05-12): We lazily import this file in order to stay
    // under the Cloudflare Workers 200ms startup time limit. If our startup time
    // limit is ever extended or if we ever move this code to AWS EC2, we should
    // remove this lazy load.
    await import("~/server/rpc/all_rpc_implementations.js");

    return _getRpcImplementationIfExists(name);
}
