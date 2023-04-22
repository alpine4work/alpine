import {MaybeSessionActionContext} from "~/server/dynamo/context/action_context";
import {assert} from "~/shared/helpers/control/assert";
import {quote} from "~/shared/helpers/string/quote";
import {BlockInference} from "~/shared/helpers/types/block_inference";
import {RpcDefinition} from "~/shared/rpc/rpc_definition";
import {SchemaSerializedValue} from "~/shared/schema/schema";

export type RpcImplementation = {
    execute(
        context: MaybeSessionActionContext,
        input: SchemaSerializedValue,
    ): Promise<SchemaSerializedValue>;
    executeWithoutSerialization(
        context: MaybeSessionActionContext,
        input: unknown,
    ): Promise<unknown>;
};

/**
 * Implements an RPC on the server. RPCs are defined in `~/shared/rpc` and
 * implemented in `~/server/rpc`. This way the client has access to the RPC
 * definitions but only the server can actually implement them.
 */
export function implementRpc<Input, Output>(
    definition: RpcDefinition<Input, Output>,
    implementation: (
        context: MaybeSessionActionContext,
        input: Input,
    ) => Promise<BlockInference<Output>>,
) {
    assert(
        !rpcImplementationByName.has(definition.name),
        quote`An implementation for RPC ${definition.name} already exists`,
    );

    const executeWithoutSerialization = (
        context: MaybeSessionActionContext,
        input: Input,
    ): Promise<Output> => {
        return context.tracer.withSpan(`RPC server ${definition.name}`, async context => {
            const output = (await implementation(context, input)) as Output;
            return output;
        });
    };

    const execute = async (
        context: MaybeSessionActionContext,
        serializedInput: SchemaSerializedValue,
    ): Promise<SchemaSerializedValue> => {
        const input = definition.inputSchema.deserialize(serializedInput);
        const output = await executeWithoutSerialization(context, input);
        return definition.outputSchema.serialize(output);
    };

    rpcImplementationByName.set(definition.name, {
        execute,
        executeWithoutSerialization,
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
 * implemented by now. Usually you will want import
 * `~/server/rpc/get_rpc_implementation` to make sure all RPC implementations
 * have been initialized.
 */
export function getRpcImplementationIfExists(name: string): RpcImplementation | null {
    return rpcImplementationByName.get(name) ?? null;
}
