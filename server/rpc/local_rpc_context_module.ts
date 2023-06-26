import {MaybeSessionActionContextModules} from "~/server/dynamo/context/action_context.js";
import {getRpcImplementationIfExists} from "~/server/rpc/get_rpc_implementation.js";
import {InternalError} from "~/shared/error/error.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";

/**
 * Executes RPCs locally in the current process. We lookup the RPC
 * implementation based on the definition name and execute it without a network
 * request.
 *
 * We do validate the input using the RPC's input schema but we don't do a
 * serialization and deserialization pass for the entire input and output.
 * We validate the input in case validations encoded in the schema are
 * important to the logic of the RPC. For example, validating a string is only
 * a single line.
 */
export class LocalRpcContextModule extends RpcContextModuleBase<MaybeSessionActionContextModules> {
    public async execute<Input, Output>(
        definition: RpcDefinition<Input, Output>,
        input: Input,
    ): Promise<Output> {
        const implementation = await getRpcImplementationIfExists(definition.name);

        if (!implementation)
            throw new InternalError("Could not find an implementation for defined RPC");

        // Validate the input in case it is important to the RPCs logic but don't do a
        // full serialization and deserialization pass.
        definition.inputSchema.validate?.(input);

        const output = await implementation.executeWithoutSerialization(this._context, input);
        return output as Output;
    }
}
