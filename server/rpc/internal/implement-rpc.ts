import {assert} from "~/shared/helpers/control/assert";
import {quote} from "~/shared/helpers/string/quote";
import {Rpc} from "~/shared/rpc/rpc";
import {SchemaSerializedValue} from "~/shared/schema/schema";

export type RpcImplementation = {
    execute: (input: SchemaSerializedValue) => Promise<SchemaSerializedValue>;
    dangerouslyExecuteWithoutSchema: (input: any) => Promise<any>;
};

/**
 * Implements an RPC on the server. RPCs are defined in `~/shared/rpc` and
 * implemented in `~/server/rpc`. This way the client has access to the RPC
 * definitions but only the server can actually implement them.
 */
export function implementRpc<Input, Output>(
    rpc: Rpc<Input, Output>,
    implementation: (input: Input) => Promise<Output>,
) {
    assert(
        !rpcImplementationByName.has(rpc.rpcName),
        quote`An implementation for RPC ${rpc.rpcName} already exists`,
    );

    const execute = async (
        serializedInput: SchemaSerializedValue,
    ): Promise<SchemaSerializedValue> => {
        const input = rpc.inputSchema.deserialize(serializedInput);
        const output = await implementation(input);
        return rpc.outputSchema.serialize(output);
    };

    rpcImplementationByName.set(rpc.rpcName, {
        execute,
        dangerouslyExecuteWithoutSchema: implementation,
    });
}

const rpcImplementationByName = new Map<string, RpcImplementation>();

/**
 * Get the names of all RPCs that have been implemented.
 */
export function getAllImplementedRpcNames(): IterableIterator<string> {
    return rpcImplementationByName.keys();
}

/**
 * Get the implementation for an RPC with the given name if it has been
 * implemented by now. Usually you will want to call `importAllRpcModules()`
 * to make sure all RPC implementations have been initialized.
 */
export function getRpcImplementationIfExists(name: string): RpcImplementation | null {
    return rpcImplementationByName.get(name) ?? null;
}
