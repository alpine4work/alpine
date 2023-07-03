import {AppActionContext} from "~/server/dynamo/context/app_action_context.js";
import {AppActorServiceName} from "~/server/dynamo/context/app_actor_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {BlockInference} from "~/shared/helpers/types/block_inference.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

export type RpcImplementation = {
    execute(
        context: AppActionContext,
        input: SchemaSerializedValue,
    ): Promise<SchemaSerializedValue>;
    executeWithoutSerialization(context: AppActionContext, input: unknown): Promise<unknown>;
};

/**
 * Implements an RPC on the server. RPCs are defined in `~/shared/rpc` and
 * implemented in `~/server/rpc`. This way the client has access to the RPC
 * definitions but only the server can actually implement them.
 *
 * You pass a `visibility` array to decide which services may call this RPC. We
 * get the name from Bazel `visibility`. In the future we may actually enforce
 * who can call an RPC with Bazel visibility for better static analysis, code
 * colocation, and bundle splitting.
 */
export function implementRpc<Input, Output>(
    definition: RpcDefinition<Input, Output>,
    {visibility: visibilityArray}: {visibility: ReadonlyArray<AppActorServiceName>},
    implementation: (context: AppActionContext, input: Input) => Promise<BlockInference<Output>>,
) {
    const visibility = new Set(visibilityArray);

    assert(
        !rpcImplementationByName.has(definition.name),
        quote`An implementation for RPC ${definition.name} already exists`,
    );

    const executeWithoutSerialization = (
        context: AppActionContext,
        input: Input,
    ): Promise<Output> => {
        return context.tracer.withSpan(`RPC server ${definition.name}`, async context => {
            // RPCs may only be executed from specific services. For instance, you can only
            // call `updateDocumentContent()` from `DocumentCollaborationService`. If
            // anyone else was able to call `updateDocumentContent()` then it would break
            // `DocumentCollaborationService`'s centralized knowledge of the current
            // document version.
            if (!visibility.has(context.actor.serviceName)) {
                throw new PermissionDeniedError(
                    quote`Can't execute RPC ${definition.name} from ${context.actor.serviceName}`,
                );
            }

            const output = (await implementation(context, input)) as Output;
            return output;
        });
    };

    const execute = async (
        context: AppActionContext,
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
