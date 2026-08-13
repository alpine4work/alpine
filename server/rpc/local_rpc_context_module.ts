import {ServerUnknownActionContextModules} from "~/server/context/server_action_context.js";
import {allRpcImplementations} from "~/server/rpc/all_rpc_implementations.js";
import {RpcServerActionExtraContextModules} from "~/server/rpc/rpc_server_action_context.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {RpcCallId} from "~/shared/id/types/id_types.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";

/**
 * Executes RPCs locally in the current process. We lookup the RPC implementation
 * based on the definition name and execute it without a network request.
 *
 * We do validate the input using the RPC's input schema but we don't do a
 * serialization and deserialization pass for the entire input and output. We
 * validate the input in case validations encoded in the schema are important to
 * the logic of the RPC. For example, validating a string is only a single line.
 */
export class LocalRpcContextModule extends RpcContextModuleBase<
    ServerUnknownActionContextModules & RpcServerActionExtraContextModules
> {
    public async execute<Input, Output>(
        definition: RpcDefinition<Input, Output>,
        callId: RpcCallId,
        input: Input,
    ): Promise<Output> {
        const implementation = allRpcImplementations.get(definition.name);

        if (!implementation)
            throw new InternalError("Could not find an implementation for defined RPC");

        const output = await implementation.executeWithoutSerialization(
            await this._context.actor.authenticate(),
            callId,
            input,
        );
        return output as Output;
    }

    public fork() {
        return new LocalRpcContextModule();
    }
}
